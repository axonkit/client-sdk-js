import { TypedEmitter } from './utils/typedEmitter';
import { getLogger } from './utils/logger';
import { SignalClient, isReconnectResponse } from './signal/SignalClient';
import { RPCClient } from './signal/RPCClient';
import { TransportManager } from './transport/TransportManager';
import { LocalParticipant } from './participant/LocalParticipant';
import { RemoteParticipant } from './participant/RemoteParticipant';
import { Participant } from './participant/Participant';
import { LocalTrackPublication } from './participant/LocalTrackPublication';
import type { RemoteTrackPublication } from './participant/RemoteTrackPublication';
import { VERSION, PROTOCOL_VERSION } from './version';
import {
  RoomState,
  DisconnectReason,
  ParticipantState,
  StreamState,
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
  type DataTrackPublishedNotification,
  type DataTrackUnpublishedNotification,
  type TrackMutedNotification,
  type TrackSubscribedQualityChangedNotification,
  type ActiveSpeakersChangedNotification,
  type RoomUpdatedNotification,
  type DisconnectNotification,
  type SubscriptionCreateRequest,
  type SubscriptionClosedNotification,
  type DataSubscriptionCreateRequest,
  type DataSubscriptionClosedNotification,
  type ParticipantInfo,
  type GroupInfo,
  type CreateGroupResponse,
  type ListGroupsResponse,
  type GroupCreatedNotification,
  type GroupUpdatedNotification,
  type GroupDeletedNotification,
  type GroupParticipantJoinedNotification,
  type GroupParticipantLeftNotification,
  type TokenRefreshedNotification,
  ConnectionQuality,
} from './protocol/types';
import type { RoomOptions, RoomConnectOptions } from './track/options';
import { defaultAudioCaptureOptions, defaultVideoCaptureOptions } from './track/options';
import type { DtlsFingerprint } from './protocol/types';
import { Track } from './track/Track';
import { LocalVideoTrack } from './track/LocalVideoTrack';
import { LocalTrack } from './track/LocalTrack';
import { RoomEvent, ParticipantEvent } from './events';
import { StatsCollector } from './stats/StatsCollector';
import { DefaultReconnectPolicy } from './room/DefaultReconnectPolicy';
import { isWeb } from './utils/browser';
import { DataStreamReceiver } from './data-stream/DataStreamManager';
import type { Message, RpcInvocationData, TextStreamHandler, ByteStreamHandler } from './types';
import type {
  MessageDeletedNotification,
  StateUpdatedNotification,
  StateDeletedNotification,
} from './protocol/types';

const log = getLogger('Room');

export type RoomEvents = {
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
  [RoomEvent.ParticipantMetadataChanged]: (
    prevMetadata: string | undefined,
    participant: Participant,
  ) => void;
  [RoomEvent.ParticipantNameChanged]: (name: string, participant: Participant) => void;
  [RoomEvent.ParticipantAttributesChanged]: (
    changed: Record<string, string>,
    participant: Participant,
  ) => void;
  [RoomEvent.TrackPublished]: (
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => void;
  [RoomEvent.TrackUnpublished]: (
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => void;
  [RoomEvent.TrackSubscribed]: (
    track: Track,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => void;
  [RoomEvent.TrackSubscriptionFailed]: (trackSid: string, participant: RemoteParticipant) => void;
  [RoomEvent.TrackUnsubscribed]: (
    track: Track,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => void;
  [RoomEvent.TrackMuted]: (
    publication: LocalTrackPublication | RemoteTrackPublication,
    participant: Participant,
  ) => void;
  [RoomEvent.TrackUnmuted]: (
    publication: LocalTrackPublication | RemoteTrackPublication,
    participant: Participant,
  ) => void;
  [RoomEvent.LocalTrackPublished]: (
    publication: LocalTrackPublication,
    participant: LocalParticipant,
  ) => void;
  [RoomEvent.LocalTrackUnpublished]: (
    publication: LocalTrackPublication,
    participant: LocalParticipant,
  ) => void;
  [RoomEvent.LocalAudioSilenceDetected]: () => void;
  [RoomEvent.ActiveSpeakersChanged]: (speakers: Participant[]) => void;
  [RoomEvent.RoomUpdated]: (room: RoomInfo) => void;
  [RoomEvent.DataReceived]: (data: ArrayBuffer, participant?: RemoteParticipant) => void;
  [RoomEvent.ConnectionQualityChanged]: (
    quality: ConnectionQuality,
    participant: Participant,
  ) => void;
  [RoomEvent.AudioPlaybackStatusChanged]: (canPlayback: boolean) => void;
  [RoomEvent.VideoPlaybackStatusChanged]: (canPlayback: boolean) => void;
  [RoomEvent.ChatMessage]: (message: Message, participant?: Participant) => void;
  [RoomEvent.MessageDeleted]: (ids: string[], type?: string) => void;
  [RoomEvent.StateUpdated]: (
    key: string,
    value: string,
    participantSid?: string,
    participantIdentity?: string,
  ) => void;
  [RoomEvent.StateDeleted]: (
    key: string,
    participantSid?: string,
    participantIdentity?: string,
  ) => void;
  [RoomEvent.TrackStreamStateChanged]: (
    publication: RemoteTrackPublication,
    streamState: StreamState,
    participant: RemoteParticipant,
  ) => void;
  [RoomEvent.GroupCreated]: (group: GroupInfo) => void;
  [RoomEvent.GroupUpdated]: (group: GroupInfo) => void;
  [RoomEvent.GroupDeleted]: (groupId: string) => void;
  [RoomEvent.GroupParticipantJoined]: (groupId: string, participant: Participant) => void;
  [RoomEvent.GroupParticipantLeft]: (groupId: string, participant: Participant) => void;
  [RoomEvent.TokenRefreshed]: (token: string) => void;
};

export class Room extends TypedEmitter<RoomEvents> {
  private _state: RoomState = RoomState.Disconnected;
  private _name = '';
  private _sid = '';
  private _serverInfo?: ServerInfo;
  private _roomInfo?: RoomInfo;
  private _options: RoomOptions;

  private url = '';
  private token = '';
  private _refreshToken = '';
  private nodeId = '';
  private participantSid = '';

  private signalClient: SignalClient;
  private rpcClient!: RPCClient;
  private transportManager!: TransportManager;
  private _localParticipant!: LocalParticipant;
  private _remoteParticipants = new Map<string, RemoteParticipant>();
  private _groups = new Map<string, GroupInfo>();
  private _sharedState = new Map<string, string>();

  private pingInterval?: ReturnType<typeof setInterval>;
  private pingTimeoutTimer?: ReturnType<typeof setTimeout>;
  private pingIntervalSec = 5;
  private pingTimeoutSec = 15;
  private lastRtt = 0;

  private reconnectAttempts = 0;
  private reconnectPolicy = new DefaultReconnectPolicy();

  private statsCollector?: StatsCollector;
  private pageLeaveHandler?: () => void;
  private deviceChangeHandler?: () => void;
  private _canPlaybackAudio = true;
  private _canPlaybackVideo = true;
  private _activeDeviceMap = new Map<MediaDeviceKind, string>();
  private dataStreamReceiver = new DataStreamReceiver();
  private _lastMessageTimestamp = 0;
  private _connectOptions: RoomConnectOptions = {};

  constructor(options?: RoomOptions) {
    super();
    this._options = options ?? {};
    this._options.audioCaptureDefaults = {
      ...defaultAudioCaptureOptions,
      ...options?.audioCaptureDefaults,
    };
    this._options.videoCaptureDefaults = {
      ...defaultVideoCaptureOptions,
      ...options?.videoCaptureDefaults,
    };
    this._options.publishDefaults = {
      ...options?.publishDefaults,
    };
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

  /**
   * Returns WebRTC stats for the underlying send and receive transports.
   */
  async getTransportStats(): Promise<{ send?: RTCStatsReport; recv?: RTCStatsReport }> {
    return this.transportManager.getStats();
  }

  /** All active groups (breakout rooms) in this room. */
  get groups(): ReadonlyMap<string, GroupInfo> {
    return this._groups;
  }

  /** Room-level shared state KV (for collaboration features like whiteboard, shared documents). */
  get sharedState(): ReadonlyMap<string, string> {
    return this._sharedState;
  }

  /**
   * Get all participants currently in the specified group.
   * Includes the local participant if they are in the group.
   */
  getGroupParticipants(groupId: string): Participant[] {
    const result: Participant[] = [];
    if (this._localParticipant?.groupId === groupId) {
      result.push(this._localParticipant);
    }
    for (const [, rp] of this._remoteParticipants) {
      if (rp.groupId === groupId) {
        result.push(rp);
      }
    }
    return result;
  }

  /**
   * Get all participants.
   */
  getParticipants(): Participant[] {
    const result: Participant[] = [];
    if (this._localParticipant && !this._localParticipant.groupId) {
      result.push(this._localParticipant);
    }
    for (const [, rp] of this._remoteParticipants) {
      if (!rp.groupId) {
        result.push(rp);
      }
    }
    return result;
  }

  /** Whether audio can be played back automatically (i.e. no autoplay restriction). */
  get canPlaybackAudio(): boolean {
    return this._canPlaybackAudio;
  }

  /** Whether video can be played back automatically. */
  get canPlaybackVideo(): boolean {
    return this._canPlaybackVideo;
  }

  /** Whether the room is currently being recorded. */
  get isRecording(): boolean {
    return this._roomInfo?.activeRecording ?? false;
  }

  /** Room-level metadata (set by the server). */
  get metadata(): string | undefined {
    return this._roomInfo?.metadata;
  }

  /** Number of participants currently in the room. */
  get numParticipants(): number {
    return this._remoteParticipants.size + 1;
  }

  /** Number of participants that are actively publishing tracks. */
  get numPublishers(): number {
    let count = 0;
    if (this._localParticipant?.trackPublications.size > 0) count++;
    for (const [, rp] of this._remoteParticipants) {
      if (rp.trackPublications.size > 0) count++;
    }
    return count;
  }

  /** List of participants currently speaking, ordered by audio level. */
  get activeSpeakers(): Participant[] {
    const speakers: Participant[] = [];
    if (this._localParticipant?.isSpeaking) speakers.push(this._localParticipant);
    for (const [, rp] of this._remoteParticipants) {
      if (rp.isSpeaking) speakers.push(rp);
    }
    speakers.sort((a, b) => b.audioLevel - a.audioLevel);
    return speakers;
  }

  /**
   * Look up a remote participant by their identity.
   */
  getParticipantByIdentity(identity: string): RemoteParticipant | undefined {
    for (const [, rp] of this._remoteParticipants) {
      if (rp.identity === identity) return rp;
    }
    return undefined;
  }

  /** Find any participant (local or remote) by SID. */
  private getParticipantBySid(sid: string): Participant | undefined {
    if (this._localParticipant?.sid === sid) return this._localParticipant;
    return this._remoteParticipants.get(sid);
  }

  // --- Group (Breakout Room) Management ---

  /**
   * Create a new group (breakout room) within this room.
   * Requires `canManageGroups` permission.
   */
  async createGroup(
    name: string,
    permissions?: import('./protocol/types').ParticipantPermission,
  ): Promise<GroupInfo> {
    const resp = await this.rpcClient.request<CreateGroupResponse>('group.create', {
      name,
      permissions,
    });
    return resp.group;
  }

  /**
   * Delete a group. All participants in the group are returned to the main room
   * and their permissions revert to room-level defaults.
   * Requires `canManageGroups` permission.
   */
  async deleteGroup(groupId: string): Promise<void> {
    await this.rpcClient.request('group.delete', { groupId });
  }

  /**
   * List all active groups in this room.
   */
  async listGroups(): Promise<GroupInfo[]> {
    const resp = await this.rpcClient.request<ListGroupsResponse>('group.list', {});
    return resp.groups;
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
   * @param kind - `videoinput`, `audioinput`, or `audiooutput`.
   * @param deviceId - The device ID to switch to.
   * @param exact - If `true`, sets the `deviceId` constraint to `exact`.
   *   Defaults to `true`.
   */
  async switchActiveDevice(kind: MediaDeviceKind, deviceId: string, exact = true): Promise<void> {
    this._activeDeviceMap.set(kind, deviceId);
    if (!this._localParticipant) return;
    const constraintValue = exact ? { exact: deviceId } : deviceId;
    for (const [, pub] of this._localParticipant.trackPublications) {
      const track = pub.track;
      if (!track || !(track instanceof LocalTrack)) continue;

      if (kind === 'audioinput' && track.kind === 'audio') {
        await (track as any).setDeviceId?.(constraintValue);
      } else if (kind === 'videoinput' && track.kind === 'video') {
        await (track as any).setDeviceId?.(constraintValue);
      } else if (kind === 'audiooutput') {
        for (const el of track.attachedElements ?? []) {
          if (typeof (el as any).setSinkId === 'function') {
            await (el as any).setSinkId(deviceId);
          }
        }
      }
    }
    // Also switch audio output on remote tracks
    if (kind === 'audiooutput') {
      for (const [, rp] of this._remoteParticipants) {
        for (const [, pub] of rp.trackPublications) {
          if (pub.track) {
            for (const el of pub.track.attachedElements ?? []) {
              if (typeof (el as any).setSinkId === 'function') {
                await (el as any).setSinkId(deviceId);
              }
            }
          }
        }
      }
    }
  }

  // --- Connect ---

  async connect(url: string, token?: string, options?: RoomConnectOptions): Promise<void> {
    if (this._state !== RoomState.Disconnected) {
      throw new Error(`Cannot connect: room state is ${this._state}`);
    }

    this.url = url;
    this.token = token ?? '';
    this._connectOptions = options ?? {};
    this.setState(RoomState.Connecting);

    try {
      if (this.transportManager) {
        this.transportManager.close();
      }
      this.transportManager = new TransportManager(this.signalClient);
      this.rpcClient = new RPCClient();

      const fingerprints: DtlsFingerprint[] = await this.transportManager.generateCertificate();
      const hasDtlsFingerprints = fingerprints.length > 0;

      const autoSubscribe = this._connectOptions.autoSubscribe ?? true;

      const joinRequest: JoinRequest = {
        room: {
          name: this._options.roomName ?? '',
          metadata: this._options.metadata,
        },
        clientInfo: { sdk: 1, version: VERSION, protocol: PROTOCOL_VERSION },
        connectionSettings: {
          autoSubscribe,
          adaptiveStream: !!this._options.adaptiveStream,
          dtlsFingerprints: hasDtlsFingerprints ? fingerprints : undefined,
        },
        reconnect: false,
        participantSid: '',
        nodeId: '',
        token: this.token || undefined,
      };

      const { response: resp } = await this.signalClient.join(url, joinRequest);
      const joinResponse = resp as JoinResponse;
      this.nodeId = joinResponse.serverInfo.nodeId;
      this.applyJoinResponse(joinResponse);

      await this.transportManager.setup(
        url,
        joinResponse,
        hasDtlsFingerprints,
        this._connectOptions.rtcConfig,
      );
      this.wireTransportEvents();

      if (this.transportManager.signalDataProducer && this.transportManager.signalDataConsumer) {
        this.rpcClient.bind(
          this.transportManager.signalDataProducer,
          this.transportManager.signalDataConsumer,
        );
      }

      this.registerRPCHandlers();
      this.registerNotificationHandlers();

      const readyReq: ReadyRequest = {
        rtpCapabilities: this.transportManager.device.recvRtpCapabilities,
      };
      const readyResp = await this.rpcClient.request<ReadyResponse>('ready', readyReq);

      if (this._localParticipant) {
        this._localParticipant.state = ParticipantState.Joined;
      }

      const readyParticipants = this.applyReadySnapshot(readyResp);

      this.setState(RoomState.Connected);
      this.scheduleReadySnapshotReplay(readyParticipants);
      this.startHeartbeat(joinResponse.pingInterval, joinResponse.pingTimeout);
      this.startStatsCollector(joinResponse.statsInterval);
      this.reconnectAttempts = 0;
      this.reconnectPolicy.reset();

      this.setupDeviceChangeListener();
      this.wireLocalParticipantEvents();

      this.emit(RoomEvent.Connected);
      log.info(`Connected to room ${this._name}`);

      this.setupPageLeaveHandler();
    } catch (err) {
      this.setState(RoomState.Disconnected);
      this.transportManager.close();
      throw err;
    }
  }

  /**
   * Disconnect from the room.
   * @param stopTracks - Whether to stop local tracks after disconnecting.
   *   Defaults to `true`.
   */
  async disconnect(stopTracks = true): Promise<void> {
    if (this._state === RoomState.Disconnected) return;

    log.info('Disconnecting from room');

    try {
      await this.rpcClient.request('leave', { reason: 'client_initiated' }).catch(() => {});
    } catch {
      // ignore
    }

    this.cleanup(DisconnectReason.ClientInitiated, stopTracks);
  }

  // --- Reconnect ---

  private async attemptReconnect(): Promise<void> {
    this.setState(RoomState.Reconnecting);
    this.emit(RoomEvent.Reconnecting);
    this.reconnectAttempts++;

    const delay = this.reconnectPolicy.nextRetryDelayInMs({
      retryCount: this.reconnectAttempts,
      elapsedMs: 0,
    });
    if (delay === null) {
      log.warn('Reconnect policy says stop');
      this.cleanup(DisconnectReason.StateMismatch);
      return;
    }

    log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    await new Promise((r) => setTimeout(r, delay));

    if (this._state !== RoomState.Reconnecting) return;

    try {
      const fingerprints = this.transportManager.getDtlsFingerprints();
      const hasDtlsFingerprints = fingerprints.length > 0;
      const savedCert = this.transportManager.getCertificate();

      const joinRequest: JoinRequest = {
        room: { name: this._name },
        clientInfo: { sdk: 1, version: VERSION, protocol: PROTOCOL_VERSION },
        connectionSettings: {
          autoSubscribe: this._connectOptions.autoSubscribe ?? true,
          adaptiveStream: !!this._options.adaptiveStream,
          dtlsFingerprints: hasDtlsFingerprints ? fingerprints : undefined,
        },
        reconnect: true,
        participantSid: this.participantSid,
        nodeId: this.nodeId,
        token: this.token || undefined,
        refreshToken: this._refreshToken || undefined,
      };

      const { response: resp } = await this.signalClient.join(this.url, joinRequest);

      if (isReconnectResponse(resp)) {
        await this.transportManager.restartIce(resp.iceParameters);
        this.setState(RoomState.Connected);
        this.reconnectAttempts = 0;
        this.reconnectPolicy.reset();
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
      if (savedCert) {
        this.transportManager.setCertificate(savedCert);
      }

      this.nodeId = jr.serverInfo.nodeId;
      this.applyJoinResponse(jr);

      await this.transportManager.setup(
        this.url,
        jr,
        hasDtlsFingerprints,
        this._connectOptions.rtcConfig,
      );
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
      // Full reconnect replaces TransportManager; remote participants still held the closed instance.
      for (const [, rp] of this._remoteParticipants) {
        rp.rebindTransport(this.transportManager, this.rpcClient);
      }

      const readyReq: ReadyRequest = {
        rtpCapabilities: this.transportManager.device.recvRtpCapabilities,
        syncState: this.buildSyncState(),
      };
      const readyResp = await this.rpcClient.request<ReadyResponse>('ready', readyReq);

      this.applyReadySnapshot(readyResp);

      // Replay messages missed during disconnect.
      if (readyResp.messages) {
        for (const m of readyResp.messages) {
          this.handleMessage(m);
        }
      }

      // Sync shared state from server.
      if (readyResp.sharedState) {
        this._sharedState.clear();
        for (const [k, v] of Object.entries(readyResp.sharedState)) {
          this._sharedState.set(k, v);
        }
      }

      await this._localParticipant.republishAllTracks();

      this.startHeartbeat(jr.pingInterval, jr.pingTimeout);
      this.startStatsCollector(jr.statsInterval);

      this.setState(RoomState.Connected);
      this.reconnectAttempts = 0;
      this.reconnectPolicy.reset();
      this.emit(RoomEvent.Reconnected);
      log.info('Reconnected successfully');
    } catch (err) {
      log.warn(`Reconnect attempt ${this.reconnectAttempts} failed`, err);
      this.attemptReconnect();
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
      lastMessageTimestamp: this._lastMessageTimestamp || undefined,
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
            el
              .play()
              .then(() => {
                if (!this._canPlaybackAudio) {
                  this._canPlaybackAudio = true;
                  this.emit(RoomEvent.AudioPlaybackStatusChanged, true);
                }
              })
              .catch(() => {}),
          );
        }
      }
    }
    await Promise.allSettled(promises);
  }

  /**
   * Attempt to start video playback on all remote video tracks.
   * Should be called from a user interaction handler when
   * `canPlaybackVideo` is `false`.
   */
  async startVideo(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [, rp] of this._remoteParticipants) {
      for (const [, pub] of rp.trackPublications) {
        if (pub.track && pub.kind === 'video') {
          const el = pub.track.attach();
          promises.push(
            el
              .play()
              .then(() => {
                if (!this._canPlaybackVideo) {
                  this._canPlaybackVideo = true;
                  this.emit(RoomEvent.VideoPlaybackStatusChanged, true);
                }
              })
              .catch(() => {}),
          );
        }
      }
    }
    await Promise.allSettled(promises);
  }

  /**
   * Returns the device ID currently active for a given kind, if known.
   */
  getActiveDevice(kind: MediaDeviceKind): string | undefined {
    return this._activeDeviceMap.get(kind);
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

  // --- Internal ---

  private applyJoinResponse(jr: JoinResponse): void {
    this._name = jr.room.name;
    this._sid = jr.room.sid;
    this._roomInfo = jr.room;
    this._serverInfo = jr.serverInfo;
    this.participantSid = jr.participant.sid;

    if (jr.refreshToken) {
      this._refreshToken = jr.refreshToken;
    }

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
    this._localParticipant.roomOptions = this._options;
    this._localParticipant.init(this.rpcClient, this.transportManager);
    this.dataStreamReceiver.setLocalIdentity(jr.participant.identity);
  }

  private registerRPCHandlers(): void {
    this.rpcClient.onRequest('subscription.create', async (body: SubscriptionCreateRequest) => {
      return this.handleSubscriptionCreate(body);
    });

    this.rpcClient.onRequest(
      'dataSubscription.create',
      async (body: DataSubscriptionCreateRequest) => {
        return this.handleDataSubscriptionCreate(body);
      },
    );
  }

  private registerNotificationHandlers(): void {
    this.rpcClient.onNotification('token.refreshed', (body: TokenRefreshedNotification) => {
      this._refreshToken = body.token;
      this.emit(RoomEvent.TokenRefreshed, body.token);
    });

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

    this.rpcClient.onNotification('dataTrack.published', (body: DataTrackPublishedNotification) => {
      this.handleDataTrackPublished(body);
    });

    this.rpcClient.onNotification(
      'dataTrack.unpublished',
      (body: DataTrackUnpublishedNotification) => {
        this.handleDataTrackUnpublished(body);
      },
    );

    this.rpcClient.onNotification('track.muted', (body: TrackMutedNotification) => {
      this.handleTrackMuted(body);
    });

    this.rpcClient.onNotification(
      'track.subscribedQualityChanged',
      (body: TrackSubscribedQualityChangedNotification) => {
        this.handleSubscribedQualityChanged(body);
      },
    );

    this.rpcClient.onNotification(
      'activeSpeakers.changed',
      (body: ActiveSpeakersChangedNotification) => {
        this.handleActiveSpeakersChanged(body);
      },
    );

    this.rpcClient.onNotification('room.updated', (body: RoomUpdatedNotification) => {
      this.handleRoomUpdated(body);
    });

    this.rpcClient.onNotification('disconnect', (body: DisconnectNotification) => {
      this.handleDisconnect(body.reason);
    });

    this.rpcClient.onNotification('subscription.closed', (body: SubscriptionClosedNotification) => {
      this.handleSubscriptionClosed(body);
    });

    this.rpcClient.onNotification(
      'dataSubscription.closed',
      (body: DataSubscriptionClosedNotification) => {
        this.handleDataSubscriptionClosed(body);
      },
    );

    this.rpcClient.onNotification('message.received', (body: any) => {
      this.handleMessage(body);
    });

    this.rpcClient.onNotification('message.deleted', (body: MessageDeletedNotification) => {
      this.emit(RoomEvent.MessageDeleted, body.ids, body.type);
    });

    this.rpcClient.onNotification('state.updated', (body: StateUpdatedNotification) => {
      this._sharedState.set(body.key, body.value);
      this.emit(
        RoomEvent.StateUpdated,
        body.key,
        body.value,
        body.participantSid,
        body.participantIdentity,
      );
    });

    this.rpcClient.onNotification('state.deleted', (body: StateDeletedNotification) => {
      this._sharedState.delete(body.key);
      this.emit(RoomEvent.StateDeleted, body.key, body.participantSid, body.participantIdentity);
    });

    this.rpcClient.onNotification('rpc.invoke', (body: any) => {
      this._localParticipant.handleRpcInvocation(body);
    });

    this.rpcClient.onNotification('rpc.response', (body: any) => {
      this._localParticipant.handleRpcResponse(body);
    });

    this.rpcClient.onNotification('group.created', (body: GroupCreatedNotification) => {
      this._groups.set(body.group.groupId, body.group);
      this.emit(RoomEvent.GroupCreated, body.group);
    });

    this.rpcClient.onNotification('group.updated', (body: GroupUpdatedNotification) => {
      this._groups.set(body.group.groupId, body.group);
      this.emit(RoomEvent.GroupUpdated, body.group);
    });

    this.rpcClient.onNotification('group.deleted', (body: GroupDeletedNotification) => {
      this._groups.delete(body.groupId);
      if (this._localParticipant.groupId === body.groupId) {
        this._localParticipant.groupId = undefined;
      }
      for (const [, rp] of this._remoteParticipants) {
        if (rp.groupId === body.groupId) {
          rp.groupId = undefined;
        }
      }
      this.emit(RoomEvent.GroupDeleted, body.groupId);
    });

    this.rpcClient.onNotification(
      'group.participantJoined',
      (body: GroupParticipantJoinedNotification) => {
        const participant = this.getParticipantBySid(body.participantSid);
        if (participant) {
          participant.groupId = body.groupId;
          this.emit(RoomEvent.GroupParticipantJoined, body.groupId, participant);
        }
      },
    );

    this.rpcClient.onNotification(
      'group.participantLeft',
      (body: GroupParticipantLeftNotification) => {
        const participant = this.getParticipantBySid(body.participantSid);
        if (participant) {
          participant.groupId = undefined;
          this.emit(RoomEvent.GroupParticipantLeft, body.groupId, participant);
        }
      },
    );
  }

  private applyReadySnapshot(readyResp: ReadyResponse): RemoteParticipant[] {
    if (readyResp.room) {
      this._roomInfo = readyResp.room;
      this._name = readyResp.room.name;
    }

    const readyParticipants = this.replaceRemoteParticipants(readyResp.otherParticipants);
    this.replaceGroups(readyResp.groups);
    this.replaceSharedState(readyResp.sharedState);
    return readyParticipants;
  }

  private replaceRemoteParticipants(participants?: ParticipantInfo[]): RemoteParticipant[] {
    if (!participants) return [];

    const nextSids = new Set<string>();
    const readyParticipants: RemoteParticipant[] = [];
    for (const info of participants) {
      nextSids.add(info.sid);
      readyParticipants.push(this.upsertRemoteParticipant(info));
    }

    for (const [sid, rp] of this._remoteParticipants) {
      if (nextSids.has(sid)) continue;
      rp.closeAll();
      this._remoteParticipants.delete(sid);
    }

    return readyParticipants;
  }

  private replaceGroups(groups?: GroupInfo[]): void {
    if (!groups) return;

    this._groups.clear();
    for (const group of groups) {
      this._groups.set(group.groupId, group);
    }
  }

  private replaceSharedState(sharedState?: Record<string, string>): void {
    if (!sharedState) return;

    this._sharedState.clear();
    for (const [key, value] of Object.entries(sharedState)) {
      this._sharedState.set(key, value);
    }
  }

  private upsertRemoteParticipant(info: ParticipantInfo): RemoteParticipant {
    const existing = this._remoteParticipants.get(info.sid);
    if (existing) {
      existing.updateFromInfo(info);
      return existing;
    }

    const rp = new RemoteParticipant(info, {
      transportManager: this.transportManager,
      rpc: this.rpcClient,
      autoSubscribe: this._connectOptions.autoSubscribe,
      streamReceiver: this.dataStreamReceiver,
    });
    this._remoteParticipants.set(info.sid, rp);
    this.wireRemoteParticipantEvents(rp);
    return rp;
  }

  private scheduleReadySnapshotReplay(participants: RemoteParticipant[]): void {
    if (participants.length === 0) return;

    const replayParticipants = participants.map((participant) => ({
      participant,
      publications: [...participant.trackPublications.values()],
    }));

    // Replay initial snapshot events after connect so apps can use the same
    // event-based path for pre-existing participants and publications.
    setTimeout(() => {
      if (this._state !== RoomState.Connected) return;

      for (const { participant, publications } of replayParticipants) {
        if (this._remoteParticipants.get(participant.sid) !== participant) continue;

        this.emit(RoomEvent.ParticipantJoined, participant);
        for (const publication of publications) {
          if (participant.getTrackPublicationBySid(publication.trackSid) !== publication) continue;

          this.emit(RoomEvent.TrackPublished, publication, participant);
        }
      }
    }, 0);
  }

  // --- Notification Handlers ---

  private handleParticipantJoined(body: ParticipantJoinedNotification): void {
    const existed = this._remoteParticipants.has(body.participant.sid);
    const rp = this.upsertRemoteParticipant(body.participant);
    if (existed) {
      this.emit(RoomEvent.ParticipantUpdated, rp);
      log.info(`Participant updated via join event: ${rp.identity} (${rp.sid})`);
      return;
    }
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
    const existed = this._remoteParticipants.has(body.participant.sid);
    const rp = this.upsertRemoteParticipant(body.participant);
    if (!existed) {
      this.emit(RoomEvent.ParticipantJoined, rp);
      log.warn(`Participant updated before join event: ${rp.identity} (${rp.sid})`);
      return;
    }
    this.emit(RoomEvent.ParticipantUpdated, rp);
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

  private handleDataTrackPublished(body: DataTrackPublishedNotification): void {
    const rp = this._remoteParticipants.get(body.participantSid);
    if (!rp) return;

    this.emit(RoomEvent.DataTrackPublished, body.dataTrack, rp);
  }

  private handleDataTrackUnpublished(body: DataTrackUnpublishedNotification): void {
    const rp = this._remoteParticipants.get(body.participantSid);
    if (!rp) return;

    this.emit(RoomEvent.DataTrackUnpublished, body.dataTrackSid, rp);
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

  /** Video dynacast: per-layer quality change + producer pause/resume. */
  private handleSubscribedQualityChanged(body: TrackSubscribedQualityChangedNotification): void {
    if (!this._options.dynacast) return;

    const pub = this._localParticipant.getTrackPublicationBySid(body.trackSid);
    if (!pub?.track || !(pub.track instanceof LocalVideoTrack)) return;

    if (body.subscribedCodecs && body.subscribedCodecs.length > 0) {
      // Per-codec quality updates — handle backup codec lifecycle
      this._localParticipant
        .handleSubscribedCodecs(pub as LocalTrackPublication, body.subscribedCodecs)
        .catch((err) => {
          log.warn('Failed to handle subscribed codecs', err);
        });
    } else {
      // Backward compatible: quality-only updates
      (pub.track as LocalVideoTrack).setDynacastQuality(body.subscribedQualities).catch((err) => {
        log.warn('Failed to set dynacast quality', err);
      });
    }
  }

  private handleActiveSpeakersChanged(body: ActiveSpeakersChangedNotification): void {
    const activeSpeakers: Participant[] = [];
    const now = new Date();
    for (const speaker of body.speakers) {
      let participant: Participant | undefined;
      if (speaker.participantSid === this.participantSid) {
        participant = this._localParticipant;
      } else {
        participant = this._remoteParticipants.get(speaker.participantSid);
      }
      if (!participant) continue;

      const wasSpeaking = participant.isSpeaking;
      participant.isSpeaking = speaker.active;
      participant.audioLevel = speaker.level;
      if (speaker.active) {
        participant.lastSpokeAt = now;
        activeSpeakers.push(participant);
      }
      if (wasSpeaking !== speaker.active) {
        participant.emit(ParticipantEvent.IsSpeakingChanged, speaker.active);
      }
    }
    activeSpeakers.sort((a, b) => b.audioLevel - a.audioLevel);
    this.emit(RoomEvent.ActiveSpeakersChanged, activeSpeakers);
  }

  private handleMessage(body: any): void {
    const msg: Message = {
      id: body.id,
      type: body.type,
      message: body.message,
      timestamp: body.timestamp,
      editTimestamp: body.editTimestamp,
      transient: body.transient,
      attachedFiles: body.attachedFiles,
    };

    const ts = msg.editTimestamp ?? msg.timestamp;
    if (ts > this._lastMessageTimestamp) {
      this._lastMessageTimestamp = ts;
    }

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

  private async handleSubscriptionCreate(
    body: SubscriptionCreateRequest,
  ): Promise<{ ok: boolean }> {
    const rp = this._remoteParticipants.get(body.publisherSid);
    if (!rp) {
      log.warn(`Subscription create for unknown publisher ${body.publisherSid}`);
      const newRp = new RemoteParticipant(
        { sid: body.publisherSid, identity: body.publisherSid, state: ParticipantState.Joined },
        {
          transportManager: this.transportManager,
          rpc: this.rpcClient,
          autoSubscribe: this._connectOptions.autoSubscribe,
        },
      );
      this._remoteParticipants.set(body.publisherSid, newRp);
      this.wireRemoteParticipantEvents(newRp);
      return newRp.handleSubscriptionCreate(body);
    }
    return rp.handleSubscriptionCreate(body);
  }

  private async handleDataSubscriptionCreate(
    body: DataSubscriptionCreateRequest,
  ): Promise<{ ok: boolean }> {
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
    rp.on(ParticipantEvent.TrackStreamStateChanged, (pub, streamState) => {
      this.emit(RoomEvent.TrackStreamStateChanged, pub, streamState, rp);
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
    this._localParticipant.on(ParticipantEvent.ChatMessage, (msg: Message) => {
      const ts = msg.editTimestamp ?? msg.timestamp;
      if (ts > this._lastMessageTimestamp) {
        this._lastMessageTimestamp = ts;
      }
      this.emit(RoomEvent.ChatMessage, msg, this._localParticipant);
    });
  }

  private setupDeviceChangeListener(): void {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    this.deviceChangeHandler = () => {
      this.emit(RoomEvent.MediaDevicesChanged);
    };
    navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeHandler);
  }

  private cleanup(reason: DisconnectReason, stopTracks = true): void {
    if (this._state === RoomState.Disconnected) return;
    this.setState(RoomState.Disconnected);

    this.stopHeartbeat();
    this.stopStatsCollector();
    this.rpcClient.close();
    this.transportManager.close();

    this._localParticipant?.closeAll(!stopTracks);
    for (const [, rp] of this._remoteParticipants) {
      rp.closeAll();
    }
    this._remoteParticipants.clear();

    if (this.pageLeaveHandler && isWeb()) {
      window.removeEventListener('beforeunload', this.pageLeaveHandler);
      window.removeEventListener('pagehide', this.pageLeaveHandler);
      window.removeEventListener('freeze', this.pageLeaveHandler);
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
    if (!isWeb()) return;

    this.pageLeaveHandler = () => {
      this.disconnect();
    };

    window.addEventListener('beforeunload', this.pageLeaveHandler);
    window.addEventListener('pagehide', this.pageLeaveHandler);
    window.addEventListener('freeze', this.pageLeaveHandler);
  }
}
