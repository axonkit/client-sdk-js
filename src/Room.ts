import { TypedEventEmitter } from './utils/events';
import { getLogger } from './utils/logger';
import { SignalClient, isReconnectResponse } from './signal/SignalClient';
import { RPCClient } from './signal/RPCClient';
import { TransportManager } from './transport/TransportManager';
import { LocalParticipant } from './participant/LocalParticipant';
import { RemoteParticipant } from './participant/RemoteParticipant';
import { VERSION, PROTOCOL_VERSION } from './version';
import {
  RoomState,
  DisconnectReason,
  type RoomInfo,
  type ServerInfo,
  type JoinRequest,
  type JoinResponse,
  type ReadyRequest,
  type ReadyResponse,
  type PingRequest,
  type PingResponse,
  type SyncState,
  type ParticipantJoinedNotification,
  type ParticipantLeftNotification,
  type ParticipantUpdatedNotification,
  type TrackPublishedNotification,
  type TrackUnpublishedNotification,
  type TrackMutedNotification,
  type TrackSubscribedQualityChangedNotification,
  type TrackSubscriptionStatusChangedNotification,
  type ActiveSpeakersChangedNotification,
  type RoomUpdatedNotification,
  type DisconnectNotification,
  type SubscriptionCreateRequest,
  type SubscriptionClosedNotification,
  type DataSubscriptionCreateRequest,
  type DataSubscriptionClosedNotification,
  type ActiveSpeaker,
  type ReconnectResponse,
} from './protocol/types';
import type { RoomOptions, ReconnectPolicy } from './track/options';
import type { DtlsFingerprint } from './protocol/types';
import { LocalVideoTrack } from './track/LocalVideoTrack';
import { LocalTrack } from './track/LocalTrack';

export interface ConnectOptions {
  displayName?: string;
  roomName?: string;
}

const log = getLogger('Room');

const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  maxRetries: 10,
  initialDelay: 1000,
  maxDelay: 30000,
};

export interface RoomEvents {
  connected: () => void;
  disconnected: (reason?: DisconnectReason) => void;
  reconnecting: () => void;
  reconnected: () => void;
  participantJoined: (participant: RemoteParticipant) => void;
  participantLeft: (participant: RemoteParticipant, reason?: string) => void;
  participantUpdated: (participant: RemoteParticipant) => void;
  trackPublished: (publication: any, participant: RemoteParticipant) => void;
  trackUnpublished: (publication: any, participant: RemoteParticipant) => void;
  trackSubscribed: (track: any, publication: any, participant: RemoteParticipant) => void;
  trackUnsubscribed: (track: any, publication: any, participant: RemoteParticipant) => void;
  trackMuted: (publication: any, participant: RemoteParticipant) => void;
  trackUnmuted: (publication: any, participant: RemoteParticipant) => void;
  activeSpeakersChanged: (speakers: ActiveSpeaker[]) => void;
  roomUpdated: (room: RoomInfo) => void;
  dataReceived: (data: ArrayBuffer, participant?: RemoteParticipant) => void;
  connectionQualityChanged: (quality: string, participant: any) => void;
}

export class Room extends TypedEventEmitter<RoomEvents> {
  private _state: RoomState = RoomState.Disconnected;
  private _name = '';
  private _sid = '';
  private _serverInfo?: ServerInfo;
  private _roomInfo?: RoomInfo;
  private _options: RoomOptions;

  private url = '';
  private token = '';
  private nodeId = '';
  private participantSid = '';

  private signalClient: SignalClient;
  private rpcClient!: RPCClient;
  private transportManager!: TransportManager;
  private _localParticipant!: LocalParticipant;
  private _remoteParticipants = new Map<string, RemoteParticipant>();

  private pingInterval?: ReturnType<typeof setInterval>;
  private pingTimeoutTimer?: ReturnType<typeof setTimeout>;
  private pingIntervalSec = 5;
  private pingTimeoutSec = 15;
  private lastRtt = 0;

  private reconnectAttempts = 0;
  private reconnectPolicy: ReconnectPolicy;

  private pageLeaveHandler?: () => void;

  constructor(options?: RoomOptions) {
    super();
    this._options = options ?? {};
    this.reconnectPolicy = options?.reconnectPolicy ?? DEFAULT_RECONNECT_POLICY;

    this.signalClient = new SignalClient();
  }

  get state(): RoomState {
    return this._state;
  }

  get name(): string {
    return this._name;
  }

  get sid(): string {
    return this._sid;
  }

  get serverInfo(): ServerInfo | undefined {
    return this._serverInfo;
  }

  get localParticipant(): LocalParticipant {
    return this._localParticipant;
  }

  get remoteParticipants(): Map<string, RemoteParticipant> {
    return this._remoteParticipants;
  }

  // --- Connect ---

  async connect(url: string, token: string, options?: ConnectOptions): Promise<void> {
    if (this._state !== RoomState.Disconnected) {
      throw new Error(`Cannot connect: room state is ${this._state}`);
    }

    this.url = url;
    this.token = token;
    this._state = RoomState.Connecting;

    try {
      // 1. Generate certificate and get DTLS fingerprints
      // Re-instantiate TransportManager to ensure clean state for every connect()
      if (this.transportManager) {
        await this.transportManager.close();
      }
      this.transportManager = new TransportManager(this.signalClient);
      
      // Re-instantiate RPCClient as it might have been closed
      this.rpcClient = new RPCClient();

      const fingerprints: DtlsFingerprint[] = await this.transportManager.generateCertificate();
      const hasDtlsFingerprints = fingerprints.length > 0;

      // 2. Build JoinRequest
      const joinRequest: JoinRequest = {
        displayName: options?.displayName ?? '',
        room: { name: options?.roomName ?? '' },
        clientInfo: { sdk: 1, version: VERSION, protocol: PROTOCOL_VERSION },
        connectionSettings: {
          autoSubscribe: this._options.autoSubscribe !== false,
          adaptiveStream: this._options.adaptiveStream === true,
          dtlsFingerprints: hasDtlsFingerprints ? fingerprints : undefined,
        },
        reconnect: false,
        participantSid: '',
        nodeId: '',
        token,
      };

      // 3. HTTP Join
      const { response: resp } = await this.signalClient.join(url, joinRequest);
      const joinResponse = resp as JoinResponse; // Cast to JoinResponse as reconnect is false
      this.nodeId = joinResponse.serverInfo.nodeId;
      this.applyJoinResponse(joinResponse);

      // 4. Setup transports + signal DataChannels
      await this.transportManager.setup(url, joinResponse, hasDtlsFingerprints);

      // 5. Bind RPC to DataChannels
      if (this.transportManager.signalDataProducer && this.transportManager.signalDataConsumer) {
        this.rpcClient.bind(
          this.transportManager.signalDataProducer,
          this.transportManager.signalDataConsumer,
        );
      }

      // 6. Register handlers
      this.registerRPCHandlers();
      this.registerNotificationHandlers();

      // 7. Send ready RPC
      const readyReq: ReadyRequest = {
        rtpCapabilities: this.transportManager.device.recvRtpCapabilities,
      };
      const readyResp = await this.rpcClient.request<ReadyResponse>('ready', readyReq);

      if (readyResp.room) {
        this._roomInfo = readyResp.room;
        this._name = readyResp.room.name;
      }

      // 8. Initialize remote participants
      if (readyResp?.otherParticipants) {
        for (const info of readyResp.otherParticipants) {
          const rp = RemoteParticipant.fromInfo(info);
          rp.init(this.transportManager, this.rpcClient);
          this._remoteParticipants.set(info.sid, rp);
          this.wireRemoteParticipantEvents(rp);
        }
      }

      // 9. Set state to connected
      this._state = RoomState.Connected;

      // 10. Start heartbeat
      this.startHeartbeat(joinResponse.pingInterval, joinResponse.pingTimeout);
      this._state = RoomState.Connected;
      this.reconnectAttempts = 0;
      this.emit('connected');
      log.info(`Connected to room ${this._name}`);

      // Setup page leave handler
      if (this._options.disconnectOnPageLeave !== false) {
        this.setupPageLeaveHandler();
      }
    } catch (err) {
      this._state = RoomState.Disconnected;
      this.transportManager.close();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this._state === RoomState.Disconnected) return;

    log.info('Disconnecting from room');

    try {
      await this.rpcClient.request('leave', { reason: 'client_initiated' }).catch(() => {});
    } catch {
      // ignore
    }

    this.cleanup(DisconnectReason.ClientInitiated);
  }

  // --- Reconnect ---

  private async attemptReconnect(): Promise<void> {
    const maxRetries = this.reconnectPolicy.maxRetries ?? 10;
    const maxDelay = this.reconnectPolicy.maxDelay ?? 30000;
    const initialDelay = this.reconnectPolicy.initialDelay ?? 1000;

    if (this.reconnectAttempts >= maxRetries) {
      log.warn('Max reconnect attempts reached');
      this.cleanup(DisconnectReason.StateMismatch);
      return;
    }

    this._state = RoomState.Reconnecting;
    this.emit('reconnecting');
    this.reconnectAttempts++;

    const delay = Math.min(initialDelay * Math.pow(2, this.reconnectAttempts - 1), maxDelay);
    log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${maxRetries})`);

    await new Promise((r) => setTimeout(r, delay));

    if (this._state !== RoomState.Reconnecting) return;

    try {
      const joinRequest: JoinRequest = {
        displayName: this._localParticipant?.name ?? '',
        room: { name: this._name },
        clientInfo: { sdk: 1, version: VERSION, protocol: PROTOCOL_VERSION },
        connectionSettings: {
          autoSubscribe: this._options.autoSubscribe !== false,
          adaptiveStream: this._options.adaptiveStream === true,
        },
        reconnect: true,
        participantSid: this.participantSid,
        nodeId: this.nodeId,
        token: this.token,
      };

      const { response: resp } = await this.signalClient.join(this.url, joinRequest);

      if (isReconnectResponse(resp)) {
        // --- ICE Restart Path ---
        await this.transportManager.restartIce(resp.iceParameters);
        this._state = RoomState.Connected;
        this.reconnectAttempts = 0;
        this.emit('reconnected');
        log.info('ICE restart completed');
        return;
      }

      // --- Full Reconnect Path ---
      const jr = resp as JoinResponse;

      // Close old transports
      this.stopHeartbeat();
      this.rpcClient.close();
      await this.transportManager.close();

      // Re-create transport manager and RPC client
      this.rpcClient = new RPCClient();
      this.transportManager = new TransportManager(this.signalClient);

      this.nodeId = jr.serverInfo.nodeId;
      this.applyJoinResponse(jr);

      await this.transportManager.setup(this.url, jr, false);

      if (this.transportManager.signalDataProducer && this.transportManager.signalDataConsumer) {
        this.rpcClient.bind(
          this.transportManager.signalDataProducer,
          this.transportManager.signalDataConsumer,
        );
      }

      this.registerRPCHandlers();
      this.registerNotificationHandlers();

      this._localParticipant.init(this.rpcClient, this.transportManager);

      const readyReq: ReadyRequest = {
        rtpCapabilities: this.transportManager.device.recvRtpCapabilities,
        syncState: this.buildSyncState(),
      };
      const readyResp = await this.rpcClient.request<ReadyResponse>('ready', readyReq);

      if (readyResp.room) {
        this._roomInfo = readyResp.room;
        this._name = readyResp.room.name;
      }

      await this.republishAllTracks();

      this.startHeartbeat(jr.pingInterval, jr.pingTimeout);

      this._state = RoomState.Connected;
      this.reconnectAttempts = 0;
      this.emit('reconnected');
      log.info('Reconnected successfully');
    } catch (err) {
      log.warn(`Reconnect attempt ${this.reconnectAttempts} failed`, err);
      this.attemptReconnect();
    }
  }

  private async republishAllTracks(): Promise<void> {
    if (!this._localParticipant) return;
    const publications = [...this._localParticipant.trackPublications.values()];
    this._localParticipant.clearPublications();
    for (const pub of publications) {
      if (pub.track) {
        try {
          await this._localParticipant.publishTrack(pub.track as LocalTrack, {
            name: pub.trackName,
            source: pub.source,
          });
        } catch (err) {
          log.warn(`Failed to republish track ${pub.trackSid}`, err);
        }
      }
    }
  }

  private buildSyncState(): SyncState {
    const subscribedTrackSids: string[] = [];
    const subscribedDataTrackSids: string[] = [];
    const publishedTrackSids: string[] = [];

    for (const [sid] of this._localParticipant.trackPublications) {
      publishedTrackSids.push(sid);
    }

    for (const [, rp] of this._remoteParticipants) {
      for (const [sid, pub] of rp.trackPublications) {
        if (pub.track) {
          subscribedTrackSids.push(sid);
        }
      }
    }

    return {
      subscribedTrackSids,
      subscribedDataTrackSids,
      publishedTrackSids,
      dataReceiveStates: [],
    };
  }

  // --- Heartbeat ---

  private startHeartbeat(intervalSec: number, timeoutSec: number): void {
    this.stopHeartbeat(); // Ensure any existing heartbeat is stopped first
    this.pingIntervalSec = intervalSec || 5;
    this.pingTimeoutSec = timeoutSec || 15;

    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, this.pingIntervalSec * 1000);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
    if (this.pingTimeoutTimer) {
      clearTimeout(this.pingTimeoutTimer);
      this.pingTimeoutTimer = undefined;
    }
  }

  private sendPing(): void {
    if (this._state !== RoomState.Connected) return;

    const timestamp = Date.now();
    const req: PingRequest = { timestamp };

    // Start timeout
    if (this.pingTimeoutTimer) clearTimeout(this.pingTimeoutTimer);
    this.pingTimeoutTimer = setTimeout(() => {
      log.warn('Ping timeout, attempting reconnect');
      this.handleDisconnect(DisconnectReason.ConnectionTimeout);
    }, this.pingTimeoutSec * 1000);

    this.rpcClient
      .request<PingResponse>('ping', req, this.pingTimeoutSec * 1000)
      .then((resp) => {
        if (this.pingTimeoutTimer) {
          clearTimeout(this.pingTimeoutTimer);
          this.pingTimeoutTimer = undefined;
        }
        this.lastRtt = Date.now() - resp.lastTimestamp;
      })
      .catch((err) => {
        log.warn('Ping failed', err);
      });
  }

  get rtt(): number {
    return this.lastRtt;
  }

  // --- Token Refresh ---

  async refreshToken(newToken: string): Promise<string> {
    this.token = newToken;
    const resp = await this.rpcClient.request<{ token: string }>('token.refresh', { token: newToken });
    this.token = resp.token;
    return resp.token;
  }

  // --- Internal ---

  private applyJoinResponse(jr: JoinResponse): void {
    this._name = jr.room.name;
    this._sid = jr.room.sid;
    this._roomInfo = jr.room;
    this._serverInfo = jr.serverInfo;
    this.participantSid = jr.participant.sid;

    if (!this._localParticipant) {
      this._localParticipant = new LocalParticipant(
        jr.participant.sid,
        jr.participant.identity,
        jr.participant.name,
        jr.participant.metadata,
      );
    } else {
      this._localParticipant.updateFromInfo(jr.participant);
    }
    this._localParticipant.init(this.rpcClient, this.transportManager);
  }

  private registerRPCHandlers(): void {
    this.rpcClient.onRequest('subscription.create', async (body: SubscriptionCreateRequest) => {
      return this.handleSubscriptionCreate(body);
    });

    this.rpcClient.onRequest('dataSubscription.create', async (body: DataSubscriptionCreateRequest) => {
      return this.handleDataSubscriptionCreate(body);
    });
  }

  private registerNotificationHandlers(): void {
    this.rpcClient.onNotification('participant.joined', (body: ParticipantJoinedNotification) => {
      this.handleParticipantJoined(body);
    });

    this.rpcClient.onNotification('participant.left', (body: ParticipantLeftNotification) => {
      this.handleParticipantLeft(body);
    });

    this.rpcClient.onNotification('participant.updated', (body: ParticipantUpdatedNotification) => {
      this.handleParticipantUpdated(body);
    });

    this.rpcClient.onNotification('track.published', (body: TrackPublishedNotification) => {
      this.handleTrackPublished(body);
    });

    this.rpcClient.onNotification('track.unpublished', (body: TrackUnpublishedNotification) => {
      this.handleTrackUnpublished(body);
    });

    this.rpcClient.onNotification('track.muted', (body: TrackMutedNotification) => {
      this.handleTrackMuted(body);
    });

    this.rpcClient.onNotification('track.subscribedQualityChanged', (body: TrackSubscribedQualityChangedNotification) => {
      this.handleSubscribedQualityChanged(body);
    });

    this.rpcClient.onNotification('track.subscriptionStatusChanged', (body: TrackSubscriptionStatusChangedNotification) => {
      this.handleSubscriptionStatusChanged(body);
    });

    this.rpcClient.onNotification('activeSpeakers.changed', (body: ActiveSpeakersChangedNotification) => {
      this.handleActiveSpeakersChanged(body);
    });

    this.rpcClient.onNotification('room.updated', (body: RoomUpdatedNotification) => {
      this.handleRoomUpdated(body);
    });

    this.rpcClient.onNotification('disconnect', (body: DisconnectNotification) => {
      this.handleDisconnect(body.reason);
    });

    this.rpcClient.onNotification('subscription.closed', (body: SubscriptionClosedNotification) => {
      this.handleSubscriptionClosed(body);
    });

    this.rpcClient.onNotification('dataSubscription.closed', (body: DataSubscriptionClosedNotification) => {
      this.handleDataSubscriptionClosed(body);
    });
  }

  // --- Notification Handlers ---

  private handleParticipantJoined(body: ParticipantJoinedNotification): void {
    const rp = RemoteParticipant.fromInfo(body.participant);
    rp.init(this.transportManager, this.rpcClient);
    this._remoteParticipants.set(rp.sid, rp);
    this.wireRemoteParticipantEvents(rp);
    this.emit('participantJoined', rp);
    log.info(`Participant joined: ${rp.identity} (${rp.sid})`);
  }

  private handleParticipantLeft(body: ParticipantLeftNotification): void {
    const rp = this._remoteParticipants.get(body.participantSid);
    if (!rp) return;

    rp.closeAll();
    this._remoteParticipants.delete(body.participantSid);
    this.emit('participantLeft', rp, body.reason);
    log.info(`Participant left: ${rp.identity} (${rp.sid})`);
  }

  private handleParticipantUpdated(body: ParticipantUpdatedNotification): void {
    const rp = this._remoteParticipants.get(body.participant.sid);
    if (!rp) return;

    rp.updateFromInfo(body.participant);
    this.emit('participantUpdated', rp);
  }

  private handleTrackPublished(body: TrackPublishedNotification): void {
    const rp = this._remoteParticipants.get(body.participantSid);
    if (!rp) return;

    const pub = rp.addTrackPublication(body.track);
    this.emit('trackPublished', pub, rp);
  }

  private handleTrackUnpublished(body: TrackUnpublishedNotification): void {
    const rp = this._remoteParticipants.get(body.participantSid);
    if (!rp) return;

    const pub = rp.removeTrackPublication(body.trackSid);
    if (pub) {
      this.emit('trackUnpublished', pub, rp);
    }
  }

  private handleTrackMuted(body: TrackMutedNotification): void {
    const rp = this._remoteParticipants.get(body.participantSid);
    if (!rp) return;

    rp.setTrackMuted(body.trackSid, body.muted);
    const pub = rp.getTrackPublicationBySid(body.trackSid);
    if (pub) {
      this.emit(body.muted ? 'trackMuted' : 'trackUnmuted', pub, rp);
    }
  }

  private handleSubscribedQualityChanged(body: TrackSubscribedQualityChangedNotification): void {
    if (!this._options.dynacast) return;

    const pub = this._localParticipant.getTrackPublicationBySid(body.trackSid);
    if (!pub?.track || !(pub.track instanceof LocalVideoTrack)) return;

    (pub.track as LocalVideoTrack).setDynacastQuality(body.subscribedQualities).catch((err) => {
      log.warn('Failed to set dynacast quality', err);
    });
  }

  private handleSubscriptionStatusChanged(body: TrackSubscriptionStatusChangedNotification): void {
    if (!this._options.dynacast) return;

    const pub = this._localParticipant.getTrackPublicationBySid(body.trackSid);
    if (!pub?.track || !(pub.track instanceof LocalVideoTrack)) return;

    (pub.track as LocalVideoTrack).setSubscriptionStatus(body.hasSubscribers).catch((err) => {
      log.warn('Failed to set subscription status', err);
    });
  }

  private handleActiveSpeakersChanged(body: ActiveSpeakersChangedNotification): void {
    for (const speaker of body.speakers) {
      if (speaker.participantSid === this.participantSid) {
        this._localParticipant.isSpeaking = speaker.active;
        this._localParticipant.audioLevel = speaker.level;
        continue;
      }
      const rp = this._remoteParticipants.get(speaker.participantSid);
      if (rp) {
        const wasSpeaking = rp.isSpeaking;
        rp.isSpeaking = speaker.active;
        rp.audioLevel = speaker.level;
        if (wasSpeaking !== speaker.active) {
          rp.emit('isSpeakingChanged', speaker.active);
        }
      }
    }
    this.emit('activeSpeakersChanged', body.speakers);
  }

  private handleRoomUpdated(body: RoomUpdatedNotification): void {
    this._roomInfo = body.room;
    this._name = body.room.name;
    this.emit('roomUpdated', body.room);
  }

  private handleDisconnect(reason: DisconnectReason): void {
    const shouldReconnect =
      reason !== DisconnectReason.ClientInitiated &&
      reason !== DisconnectReason.DuplicateIdentity &&
      reason !== DisconnectReason.ParticipantRemoved &&
      reason !== DisconnectReason.RoomDeleted;

    if (shouldReconnect) {
      this.attemptReconnect();
    } else {
      this.cleanup(reason);
    }
  }

  private async handleSubscriptionCreate(body: SubscriptionCreateRequest): Promise<{ ok: boolean }> {
    const rp = this._remoteParticipants.get(body.publisherSid);
    if (!rp) {
      log.warn(`Subscription create for unknown publisher ${body.publisherSid}`);
      // Create a placeholder participant
      const { RemoteParticipant: RP } = await import('./participant/RemoteParticipant');
      const newRp = new RP(body.publisherSid, body.publisherSid);
      newRp.init(this.transportManager, this.rpcClient);
      this._remoteParticipants.set(body.publisherSid, newRp);
      this.wireRemoteParticipantEvents(newRp);
      return newRp.handleSubscriptionCreate(body);
    }
    return rp.handleSubscriptionCreate(body);
  }

  private async handleDataSubscriptionCreate(body: DataSubscriptionCreateRequest): Promise<{ ok: boolean }> {
    const rp = this._remoteParticipants.get(body.publisherSid);
    if (!rp) {
      log.warn(`Data subscription create for unknown publisher ${body.publisherSid}`);
      return { ok: false };
    }
    return rp.handleDataSubscriptionCreate(body);
  }

  private handleSubscriptionClosed(body: SubscriptionClosedNotification): void {
    for (const [, rp] of this._remoteParticipants) {
      rp.handleSubscriptionClosed(body.subscriptionSid);
    }
  }

  private handleDataSubscriptionClosed(body: DataSubscriptionClosedNotification): void {
    for (const [, rp] of this._remoteParticipants) {
      rp.handleDataSubscriptionClosed(body.dataSubscriptionSid);
    }
  }

  private wireRemoteParticipantEvents(rp: RemoteParticipant): void {
    rp.on('trackSubscribed', (track, pub) => {
      this.emit('trackSubscribed', track, pub, rp);
    });
    rp.on('trackUnsubscribed', (track, pub) => {
      this.emit('trackUnsubscribed', track, pub, rp);
    });
    rp.on('trackPublished', (pub) => {
      this.emit('trackPublished', pub, rp);
    });
    rp.on('trackUnpublished', (pub) => {
      this.emit('trackUnpublished', pub, rp);
    });
    rp.on('trackMuted', (pub) => {
      this.emit('trackMuted', pub, rp);
    });
    rp.on('trackUnmuted', (pub) => {
      this.emit('trackUnmuted', pub, rp);
    });
  }

  private cleanup(reason: DisconnectReason): void {
    if (this._state === RoomState.Disconnected) return;
    this._state = RoomState.Disconnected;

    this.stopHeartbeat();
    this.rpcClient.close();
    this.transportManager.close().catch(() => {});

    this._localParticipant?.closeAll();
    for (const [, rp] of this._remoteParticipants) {
      rp.closeAll();
    }
    this._remoteParticipants.clear();

    if (this.pageLeaveHandler) {
      window.removeEventListener('beforeunload', this.pageLeaveHandler);
      this.pageLeaveHandler = undefined;
    }

    this.emit('disconnected', reason);
    log.info(`Disconnected from room: reason=${DisconnectReason[reason]}`);
  }

  private setupPageLeaveHandler(): void {
    if (typeof window === 'undefined') return;

    this.pageLeaveHandler = () => {
      this.disconnect();
    };
    window.addEventListener('beforeunload', this.pageLeaveHandler);
  }

  // --- Audio Playback ---

  async startAudio(): Promise<void> {
    for (const [, rp] of this._remoteParticipants) {
      for (const [, pub] of rp.trackPublications) {
        if (pub.track && pub.kind === 'audio') {
          const el = pub.track.attach();
          el.play().catch(() => {});
        }
      }
    }
  }

  // --- Prepare Connection (pre-warm) ---

  async prepareConnection(url: string, token: string): Promise<void> {
    log.info('Pre-warming connection (placeholder)');
    this.url = url;
    this.token = token;
  }
}
