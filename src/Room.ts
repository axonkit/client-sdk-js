import { TypedEventEmitter } from './utils/events';
import { getLogger } from './utils/logger';
import { SignalClient, isReconnectResponse } from './signal/SignalClient';
import { RPCClient } from './signal/RPCClient';
import { TransportManager } from './transport/TransportManager';
import { LocalParticipant } from './participant/LocalParticipant';
import { RemoteParticipant } from './participant/RemoteParticipant';
import type { TrackPublication } from './participant/Participant';
import { VERSION, PROTOCOL_VERSION } from './version';
import {
  RoomState,
  DisconnectReason,
  ParticipantState,
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
} from './protocol/types';
import type { RoomOptions, ReconnectPolicy } from './track/options';
import type { DtlsFingerprint } from './protocol/types';
import { LocalVideoTrack } from './track/LocalVideoTrack';
import { LocalTrack } from './track/LocalTrack';
import { RoomEvent, ParticipantEvent } from './events';
import { StatsCollector } from './stats/StatsCollector';
import { DefaultReconnectPolicy } from './room/DefaultReconnectPolicy';
import { DataStreamReceiver } from './data-stream/DataStreamManager';
import type { ChatMessage, RpcInvocationData, TextStreamHandler, ByteStreamHandler } from './types';
import { RpcError } from './rpc';

/**
 * Options passed when connecting to a room.
 */
export interface ConnectOptions {
  /** Display name used for the local participant. */
  displayName?: string;
  /** Room name. */
  roomName?: string;
  /** Whether to auto-subscribe to published tracks (overrides RoomOptions). */
  autoSubscribe?: boolean;
  /** Timeout in milliseconds to wait for peer connections. */
  peerConnectionTimeout?: number;
  /** Additional RTCConfiguration for the peer connections. */
  rtcConfig?: RTCConfiguration;
}

const log = getLogger('Room');

export interface RoomEvents {
  [RoomEvent.Connected]: () => void;
  [RoomEvent.Disconnected]: (reason?: DisconnectReason) => void;
  [RoomEvent.Reconnecting]: () => void;
  [RoomEvent.Reconnected]: () => void;
  [RoomEvent.ConnectionStateChanged]: (state: RoomState) => void;
  [RoomEvent.SignalReconnecting]: () => void;
  [RoomEvent.MediaDevicesChanged]: () => void;
  [RoomEvent.MediaDevicesError]: (error: Error) => void;
  [RoomEvent.ParticipantJoined]: (participant: RemoteParticipant) => void;
  [RoomEvent.ParticipantLeft]: (participant: RemoteParticipant, reason?: string) => void;
  [RoomEvent.ParticipantUpdated]: (participant: RemoteParticipant) => void;
  [RoomEvent.ParticipantMetadataChanged]: (prevMetadata: string | undefined, participant: any) => void;
  [RoomEvent.ParticipantNameChanged]: (name: string, participant: any) => void;
  [RoomEvent.ParticipantAttributesChanged]: (changed: Record<string, string>, participant: any) => void;
  [RoomEvent.TrackPublished]: (publication: any, participant: RemoteParticipant) => void;
  [RoomEvent.TrackUnpublished]: (publication: any, participant: RemoteParticipant) => void;
  [RoomEvent.TrackSubscribed]: (track: any, publication: any, participant: RemoteParticipant) => void;
  [RoomEvent.TrackSubscriptionFailed]: (trackSid: string, participant: RemoteParticipant) => void;
  [RoomEvent.TrackUnsubscribed]: (track: any, publication: any, participant: RemoteParticipant) => void;
  [RoomEvent.TrackMuted]: (publication: any, participant: any) => void;
  [RoomEvent.TrackUnmuted]: (publication: any, participant: any) => void;
  [RoomEvent.LocalTrackPublished]: (publication: TrackPublication, participant: LocalParticipant) => void;
  [RoomEvent.LocalTrackUnpublished]: (publication: TrackPublication, participant: LocalParticipant) => void;
  [RoomEvent.LocalAudioSilenceDetected]: () => void;
  [RoomEvent.ActiveSpeakersChanged]: (speakers: ActiveSpeaker[]) => void;
  [RoomEvent.RoomUpdated]: (room: RoomInfo) => void;
  [RoomEvent.DataReceived]: (data: ArrayBuffer, participant?: RemoteParticipant) => void;
  [RoomEvent.ConnectionQualityChanged]: (quality: string, participant: any) => void;
  [RoomEvent.AudioPlaybackStatusChanged]: (canPlayback: boolean) => void;
  [RoomEvent.ChatMessage]: (message: any, participant?: any) => void;
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
  private _reconnectPolicy: DefaultReconnectPolicy;

  private statsCollector?: StatsCollector;
  private pageLeaveHandler?: () => void;
  private deviceChangeHandler?: () => void;
  private _canPlaybackAudio = true;
  private dataStreamReceiver = new DataStreamReceiver();

  constructor(options?: RoomOptions) {
    super();
    this._options = options ?? {};
    this.reconnectPolicy = options?.reconnectPolicy ?? {};
    this._reconnectPolicy = new DefaultReconnectPolicy(this.reconnectPolicy.maxRetries);
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

  /** Whether audio can be played back automatically (i.e. no autoplay restriction). */
  get canPlaybackAudio(): boolean {
    return this._canPlaybackAudio;
  }

  // --- Device Management ---

  /**
   * Enumerate available media input/output devices.
   * @param kind - Filter by device kind. If omitted, all devices are returned.
   */
  static async getLocalDevices(kind?: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (kind) {
      return devices.filter((d) => d.kind === kind);
    }
    return devices;
  }

  /**
   * Switch the active device for a given kind across all published tracks.
   */
  async switchActiveDevice(kind: MediaDeviceKind, deviceId: string): Promise<void> {
    if (!this._localParticipant) return;
    for (const [, pub] of this._localParticipant.trackPublications) {
      const track = pub.track;
      if (!track || !(track instanceof LocalTrack)) continue;

      if (kind === 'audioinput' && track.kind === 'audio') {
        await (track as any).setDeviceId?.(deviceId);
      } else if (kind === 'videoinput' && track.kind === 'video') {
        await (track as any).setDeviceId?.(deviceId);
      } else if (kind === 'audiooutput') {
        for (const el of (track as any).attachedElements ?? []) {
          if (typeof el.setSinkId === 'function') {
            await el.setSinkId(deviceId);
          }
        }
      }
    }
  }

  // --- Connect ---

  async connect(url: string, token: string, options?: ConnectOptions): Promise<void> {
    if (this._state !== RoomState.Disconnected) {
      throw new Error(`Cannot connect: room state is ${this._state}`);
    }

    this.url = url;
    this.token = token;
    this.setState(RoomState.Connecting);

    try {
      if (this.transportManager) {
        this.transportManager.close();
      }
      this.transportManager = new TransportManager(this.signalClient);
      this.rpcClient = new RPCClient();

      const fingerprints: DtlsFingerprint[] = await this.transportManager.generateCertificate();
      const hasDtlsFingerprints = fingerprints.length > 0;

      const autoSubscribe = options?.autoSubscribe ?? this._options.autoSubscribe ?? true;

      const joinRequest: JoinRequest = {
        displayName: options?.displayName ?? '',
        room: { name: options?.roomName ?? '' },
        clientInfo: { sdk: 1, version: VERSION, protocol: PROTOCOL_VERSION },
        connectionSettings: {
          autoSubscribe,
          adaptiveStream: !!this._options.adaptiveStream,
          dtlsFingerprints: hasDtlsFingerprints ? fingerprints : undefined,
        },
        reconnect: false,
        participantSid: '',
        nodeId: '',
        token,
      };

      const { response: resp } = await this.signalClient.join(url, joinRequest);
      const joinResponse = resp as JoinResponse;
      this.nodeId = joinResponse.serverInfo.nodeId;
      this.applyJoinResponse(joinResponse);

      await this.transportManager.setup(url, joinResponse, hasDtlsFingerprints);
      this.wireTransportEvents();

      if (this.transportManager.signalDataProducer && this.transportManager.signalDataConsumer) {
        this.rpcClient.bind(
          this.transportManager.signalDataProducer,
          this.transportManager.signalDataConsumer,
        );
      }

      this.registerRPCHandlers();
      this.registerNotificationHandlers();

      if (this._localParticipant) {
        this._localParticipant.state = ParticipantState.Connected;
      }

      const readyReq: ReadyRequest = {
        rtpCapabilities: this.transportManager.device.recvRtpCapabilities,
      };
      const readyResp = await this.rpcClient.request<ReadyResponse>('ready', readyReq);

      if (readyResp.room) {
        this._roomInfo = readyResp.room;
        this._name = readyResp.room.name;
      }

      if (readyResp?.otherParticipants) {
        for (const info of readyResp.otherParticipants) {
          const rp = RemoteParticipant.fromInfo(info);
          rp.init(this.transportManager, this.rpcClient, this.dataStreamReceiver);
          this._remoteParticipants.set(info.sid, rp);
          this.wireRemoteParticipantEvents(rp);
        }
      }

      this.setState(RoomState.Connected);
      this.startHeartbeat(joinResponse.pingInterval, joinResponse.pingTimeout);
      this.startStatsCollector(joinResponse.statsInterval);
      this.reconnectAttempts = 0;
      this._reconnectPolicy.reset();

      this.setupDeviceChangeListener();
      this.wireLocalParticipantEvents();

      this.emit(RoomEvent.Connected);
      log.info(`Connected to room ${this._name}`);

      if (this._options.disconnectOnPageLeave !== false) {
        this.setupPageLeaveHandler();
      }
    } catch (err) {
      this.setState(RoomState.Disconnected);
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

    if (this.reconnectAttempts >= maxRetries) {
      log.warn('Max reconnect attempts reached');
      this.cleanup(DisconnectReason.StateMismatch);
      return;
    }

    this.setState(RoomState.Reconnecting);
    this.emit(RoomEvent.Reconnecting);
    this.reconnectAttempts++;

    const delay = this._reconnectPolicy.nextRetryDelayInMs({
      retryCount: this.reconnectAttempts,
      elapsedMs: 0,
    });
    if (delay === null) {
      log.warn('Reconnect policy says stop');
      this.cleanup(DisconnectReason.StateMismatch);
      return;
    }

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
          adaptiveStream: !!this._options.adaptiveStream,
        },
        reconnect: true,
        participantSid: this.participantSid,
        nodeId: this.nodeId,
        token: this.token,
      };

      const { response: resp } = await this.signalClient.join(this.url, joinRequest);

      if (isReconnectResponse(resp)) {
        await this.transportManager.restartIce(resp.iceParameters);
        this.setState(RoomState.Connected);
        this.reconnectAttempts = 0;
        this._reconnectPolicy.reset();
        this.emit(RoomEvent.Reconnected);
        log.info('ICE restart completed');
        return;
      }

      const jr = resp as JoinResponse;
      this.stopHeartbeat();
      this.stopStatsCollector();
      this.rpcClient.close();
      this.transportManager.close();

      this.rpcClient = new RPCClient();
      this.transportManager = new TransportManager(this.signalClient);

      this.nodeId = jr.serverInfo.nodeId;
      this.applyJoinResponse(jr);

      await this.transportManager.setup(this.url, jr, false);
      this.wireTransportEvents();

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
      this.startStatsCollector(jr.statsInterval);

      this.setState(RoomState.Connected);
      this.reconnectAttempts = 0;
      this._reconnectPolicy.reset();
      this.emit(RoomEvent.Reconnected);
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
        const localTrack = pub.track as LocalTrack;
        localTrack.producer = undefined;

        if (localTrack.mediaStreamTrack?.readyState === 'ended') {
          log.info(`Track ${pub.trackSid} ended, attempting to restart and republish`);
          try {
            await localTrack.restart();
          } catch (err) {
            log.warn(`Failed to restart track ${pub.trackSid}`, err);
            continue;
          }
        }

        try {
          await this._localParticipant.publishTrack(localTrack, {
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

  // --- State management ---

  private setState(state: RoomState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit(RoomEvent.ConnectionStateChanged, state);
  }

  // --- Heartbeat ---

  private startHeartbeat(intervalSec: number, timeoutSec: number): void {
    this.stopHeartbeat();
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

    const idleThreshold = this.pingIntervalSec * 1000;
    if (this.rpcClient.lastSentAt > 0 && Date.now() - this.rpcClient.lastSentAt < idleThreshold) {
      return;
    }

    const timestamp = Date.now();
    const req: PingRequest = { timestamp };

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

  // --- Stats ---

  private startStatsCollector(intervalSec?: number): void {
    this.stopStatsCollector();
    if (!intervalSec || intervalSec <= 0) return;

    this.statsCollector = new StatsCollector(
      this.rpcClient,
      this.transportManager,
      this._localParticipant,
      this._remoteParticipants,
    );
    this.statsCollector.start(intervalSec);
  }

  private stopStatsCollector(): void {
    if (this.statsCollector) {
      this.statsCollector.stop();
      this.statsCollector = undefined;
    }
  }

  // --- Token Refresh ---

  async refreshToken(newToken: string): Promise<string> {
    this.token = newToken;
    const resp = await this.rpcClient.request<{ token: string }>('token.refresh', { token: newToken });
    this.token = resp.token;
    return resp.token;
  }

  // --- Audio Playback ---

  /**
   * Attempt to start audio playback on all remote audio tracks.
   * Should be called from a user interaction handler when
   * `canPlaybackAudio` is `false`.
   */
  async startAudio(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [, rp] of this._remoteParticipants) {
      for (const [, pub] of rp.trackPublications) {
        if (pub.track && pub.kind === 'audio') {
          const el = pub.track.attach();
          promises.push(
            el.play().then(() => {
              if (!this._canPlaybackAudio) {
                this._canPlaybackAudio = true;
                this.emit(RoomEvent.AudioPlaybackStatusChanged, true);
              }
            }).catch(() => {}),
          );
        }
      }
    }
    await Promise.allSettled(promises);
  }

  // --- P2P RPC ---

  /**
   * Register an RPC method handler. When a remote participant calls
   * `performRpc` with the given method name, the handler is invoked.
   *
   * @param method - Method name to handle.
   * @param handler - Async function that receives invocation data and returns
   *   a string payload.
   */
  registerRpcMethod(method: string, handler: (data: RpcInvocationData) => Promise<string>): void {
    this._localParticipant.rpcHandlers.set(method, handler);
  }

  /**
   * Remove a previously registered RPC method handler.
   */
  unregisterRpcMethod(method: string): void {
    this._localParticipant.rpcHandlers.delete(method);
  }

  // --- Data Stream Handlers ---

  /**
   * Register a handler for incoming text streams on a specific topic.
   */
  registerTextStreamHandler(topic: string, handler: TextStreamHandler): void {
    this.dataStreamReceiver.registerTextStreamHandler(topic, handler);
  }

  /**
   * Unregister a previously registered text stream handler.
   */
  unregisterTextStreamHandler(topic: string): void {
    this.dataStreamReceiver.unregisterTextStreamHandler(topic);
  }

  /**
   * Register a handler for incoming byte streams on a specific topic.
   */
  registerByteStreamHandler(topic: string, handler: ByteStreamHandler): void {
    this.dataStreamReceiver.registerByteStreamHandler(topic, handler);
  }

  /**
   * Unregister a previously registered byte stream handler.
   */
  unregisterByteStreamHandler(topic: string): void {
    this.dataStreamReceiver.unregisterByteStreamHandler(topic);
  }

  // --- Prepare Connection (pre-warm) ---

  async prepareConnection(url: string, token: string): Promise<void> {
    log.info('Pre-warming connection (placeholder)');
    this.url = url;
    this.token = token;
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
    this.dataStreamReceiver.setLocalIdentity(jr.participant.identity);
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

    this.rpcClient.onNotification('chat.message', (body: any) => {
      this.handleChatMessage(body);
    });

    this.rpcClient.onNotification('rpc.invoke', (body: any) => {
      this._localParticipant.handleRpcInvocation(body);
    });

    this.rpcClient.onNotification('rpc.response', (body: any) => {
      this._localParticipant.handleRpcResponse(body);
    });
  }

  // --- Notification Handlers ---

  private handleParticipantJoined(body: ParticipantJoinedNotification): void {
    const rp = RemoteParticipant.fromInfo(body.participant);
    rp.init(this.transportManager, this.rpcClient, this.dataStreamReceiver);
    this._remoteParticipants.set(rp.sid, rp);
    this.wireRemoteParticipantEvents(rp);
    this.emit(RoomEvent.ParticipantJoined, rp);
    log.info(`Participant joined: ${rp.identity} (${rp.sid})`);
  }

  private handleParticipantLeft(body: ParticipantLeftNotification): void {
    const rp = this._remoteParticipants.get(body.participantSid);
    if (!rp) return;

    rp.closeAll();
    this._remoteParticipants.delete(body.participantSid);
    this.emit(RoomEvent.ParticipantLeft, rp, body.reason);
    log.info(`Participant left: ${rp.identity} (${rp.sid})`);
  }

  private handleParticipantUpdated(body: ParticipantUpdatedNotification): void {
    const rp = this._remoteParticipants.get(body.participant.sid);
    if (!rp) return;

    const prevMetadata = rp.metadata;
    const prevName = rp.name;
    rp.updateFromInfo(body.participant);
    this.emit(RoomEvent.ParticipantUpdated, rp);

    if (prevMetadata !== rp.metadata) {
      this.emit(RoomEvent.ParticipantMetadataChanged, prevMetadata, rp);
    }
    if (prevName !== rp.name) {
      this.emit(RoomEvent.ParticipantNameChanged, rp.name!, rp);
    }
  }

  private handleTrackPublished(body: TrackPublishedNotification): void {
    const rp = this._remoteParticipants.get(body.participantSid);
    if (!rp) return;

    const pub = rp.addTrackPublication(body.track);
    this.emit(RoomEvent.TrackPublished, pub, rp);
  }

  private handleTrackUnpublished(body: TrackUnpublishedNotification): void {
    const rp = this._remoteParticipants.get(body.participantSid);
    if (!rp) return;

    const pub = rp.removeTrackPublication(body.trackSid);
    if (pub) {
      this.emit(RoomEvent.TrackUnpublished, pub, rp);
    }
  }

  private handleTrackMuted(body: TrackMutedNotification): void {
    const rp = this._remoteParticipants.get(body.participantSid);
    if (!rp) return;

    rp.setTrackMuted(body.trackSid, body.muted);
    const pub = rp.getTrackPublicationBySid(body.trackSid);
    if (pub) {
      this.emit(body.muted ? RoomEvent.TrackMuted : RoomEvent.TrackUnmuted, pub, rp);
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
          rp.emit(ParticipantEvent.IsSpeakingChanged, speaker.active);
        }
      }
    }
    this.emit(RoomEvent.ActiveSpeakersChanged, body.speakers);
  }

  private handleChatMessage(body: any): void {
    const msg: ChatMessage = {
      id: body.id,
      message: body.message,
      timestamp: body.timestamp,
      editTimestamp: body.editTimestamp,
      attachedFiles: body.attachedFiles,
    };
    const participant = body.participantSid
      ? this._remoteParticipants.get(body.participantSid)
      : undefined;
    participant?.emit(ParticipantEvent.ChatMessage, msg);
    this.emit(RoomEvent.ChatMessage, msg, participant);
  }

  private handleRoomUpdated(body: RoomUpdatedNotification): void {
    this._roomInfo = body.room;
    this._name = body.room.name;
    this.emit(RoomEvent.RoomUpdated, body.room);
  }

  private handleDisconnect(reason: DisconnectReason): void {
    log.info(`handleDisconnect: ${DisconnectReason[reason]}`);

    const isHardFailure =
      reason === DisconnectReason.ClientInitiated ||
      reason === DisconnectReason.DuplicateIdentity ||
      reason === DisconnectReason.ParticipantRemoved ||
      reason === DisconnectReason.RoomDeleted;

    if (this._state === RoomState.Reconnecting) {
      if (isHardFailure) {
        this.cleanup(reason);
      }
      return;
    }

    if (!isHardFailure) {
      this.attemptReconnect();
    } else {
      this.cleanup(reason);
    }
  }

  private async handleSubscriptionCreate(body: SubscriptionCreateRequest): Promise<{ ok: boolean }> {
    const rp = this._remoteParticipants.get(body.publisherSid);
    if (!rp) {
      log.warn(`Subscription create for unknown publisher ${body.publisherSid}`);
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
    rp.on(ParticipantEvent.TrackSubscribed, (track, pub) => {
      this.emit(RoomEvent.TrackSubscribed, track, pub, rp);
    });
    rp.on(ParticipantEvent.TrackUnsubscribed, (track, pub) => {
      this.emit(RoomEvent.TrackUnsubscribed, track, pub, rp);
    });
    rp.on(ParticipantEvent.TrackPublished, (pub) => {
      this.emit(RoomEvent.TrackPublished, pub, rp);
    });
    rp.on(ParticipantEvent.TrackUnpublished, (pub) => {
      this.emit(RoomEvent.TrackUnpublished, pub, rp);
    });
    rp.on(ParticipantEvent.TrackMuted, (pub) => {
      this.emit(RoomEvent.TrackMuted, pub, rp);
    });
    rp.on(ParticipantEvent.TrackUnmuted, (pub) => {
      this.emit(RoomEvent.TrackUnmuted, pub, rp);
    });
    rp.on(ParticipantEvent.DataReceived, (data) => {
      this.emit(RoomEvent.DataReceived, data, rp);
    });
    rp.on(ParticipantEvent.MetadataChanged, (metadata, participant) => {
      this.emit(RoomEvent.ParticipantMetadataChanged, metadata, participant);
    });
    rp.on(ParticipantEvent.NameChanged, (name, participant) => {
      this.emit(RoomEvent.ParticipantNameChanged, name!, participant);
    });
    rp.on(ParticipantEvent.AttributesChanged, (changed, participant) => {
      this.emit(RoomEvent.ParticipantAttributesChanged, changed, participant);
    });
  }

  private wireLocalParticipantEvents(): void {
    if (!this._localParticipant) return;
    this._localParticipant.on(ParticipantEvent.LocalTrackPublished, (pub) => {
      this.emit(RoomEvent.LocalTrackPublished, pub, this._localParticipant);
    });
    this._localParticipant.on(ParticipantEvent.LocalTrackUnpublished, (pub) => {
      this.emit(RoomEvent.LocalTrackUnpublished, pub, this._localParticipant);
    });
    this._localParticipant.on(ParticipantEvent.TrackMuted, (pub) => {
      this.emit(RoomEvent.TrackMuted, pub, this._localParticipant);
    });
    this._localParticipant.on(ParticipantEvent.TrackUnmuted, (pub) => {
      this.emit(RoomEvent.TrackUnmuted, pub, this._localParticipant);
    });
  }

  private setupDeviceChangeListener(): void {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    this.deviceChangeHandler = () => {
      this.emit(RoomEvent.MediaDevicesChanged);
    };
    navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeHandler);
  }

  private cleanup(reason: DisconnectReason): void {
    if (this._state === RoomState.Disconnected) return;
    this.setState(RoomState.Disconnected);

    this.stopHeartbeat();
    this.stopStatsCollector();
    this.rpcClient.close();
    this.transportManager.close();

    this._localParticipant?.closeAll();
    for (const [, rp] of this._remoteParticipants) {
      rp.closeAll();
    }
    this._remoteParticipants.clear();

    if (this.pageLeaveHandler) {
      window.removeEventListener('beforeunload', this.pageLeaveHandler);
      this.pageLeaveHandler = undefined;
    }

    if (this.deviceChangeHandler && typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeHandler);
      this.deviceChangeHandler = undefined;
    }

    this.emit(RoomEvent.Disconnected, reason);
    log.info(`Disconnected from room: reason=${DisconnectReason[reason]}`);
  }

  private wireTransportEvents(): void {
    this.transportManager.on('connectionFailed', (direction) => {
      log.warn(`Transport connection failed (${direction}), attempting reconnect`);
      this.handleDisconnect(DisconnectReason.MediaFailure);
    });
  }

  private setupPageLeaveHandler(): void {
    if (typeof window === 'undefined') return;

    this.pageLeaveHandler = () => {
      this.disconnect();
    };
    window.addEventListener('beforeunload', this.pageLeaveHandler);
  }
}
