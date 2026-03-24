import type { types as mediasoupTypes } from 'mediasoup-client';

// --- Enums ---

export enum RoomState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
}

export enum ConnectionQuality {
  Excellent = 'excellent',
  Good = 'good',
  Poor = 'poor',
  Lost = 'lost',
  Unknown = 'unknown',
}

export enum TrackKind {
  Audio = 'audio',
  Video = 'video',
}

export enum TrackSource {
  Camera = 'camera',
  Microphone = 'microphone',
  ScreenShare = 'screen_share',
  ScreenShareAudio = 'screen_share_audio',
  Unknown = 'unknown',
}

export enum VideoQuality {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
}

export enum AudioTrackFeature {
  AutoGainControl = 'auto_gain_control',
  EchoCancellation = 'echo_cancellation',
  NoiseSuppression = 'noise_suppression',
  Stereo = 'stereo',
  NoDtx = 'no_dtx',
  EnhancedNoiseCancellation = 'enhanced_noise_cancellation',
}

export enum StreamState {
  Active = 'active',
  Paused = 'paused',
  Unknown = 'unknown',
}

export enum DisconnectReason {
  UnknownReason = 0,
  ClientInitiated = 1,
  DuplicateIdentity = 2,
  ServerShutdown = 3,
  ParticipantRemoved = 4,
  RoomDeleted = 5,
  StateMismatch = 6,
  JoinFailure = 7,
  Migration = 8,
  SignalClose = 9,
  RoomClosed = 10,
  UserUnavailable = 11,
  UserRejected = 12,
  SipTrunkFailure = 13,
  ConnectionTimeout = 14,
  MediaFailure = 15,
}

export enum ParticipantState {
  Joining = 0,
  Joined = 1,
  Suspended = 2,
  Disconnected = 3,
}

// --- Transport Params ---

export interface IceParameters {
  usernameFragment: string;
  password: string;
  iceLite?: boolean;
}

export interface IceCandidate {
  foundation: string;
  priority: number;
  ip: string;
  address?: string;
  protocol: 'udp' | 'tcp';
  port: number;
  type: 'host' | 'srflx' | 'prflx' | 'relay';
  tcpType?: 'active' | 'passive' | 'so';
}

export interface DtlsParameters {
  role?: 'auto' | 'client' | 'server';
  fingerprints: DtlsFingerprint[];
}

export interface DtlsFingerprint {
  algorithm: string;
  value: string;
}

export interface SctpParameters {
  port: number;
  OS: number;
  MIS: number;
  maxMessageSize: number;
}

export interface SctpStreamParameters {
  streamId: number;
  ordered?: boolean;
  maxPacketLifeTime?: number;
  maxRetransmits?: number;
}

export interface TransportParams {
  sid: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
  sctpParameters?: SctpParameters;
}

// --- Signal DataChannel Info ---

export interface DataChannelInfo {
  channelSid: string;
  dataSourceSid?: string;
  sctpStreamParameters: SctpStreamParameters;
  label: string;
  protocol: string;
}

export interface SignalChannels {
  receive: DataChannelInfo & { dataSourceSid: string };
  send: DataChannelInfo;
}

// --- Server / Room / Participant / Track Info ---

export interface ServerInfo {
  nodeId: string;
  region: string;
  protocol: number;
}

export interface RoomInfo {
  sid: string;
  name: string;
  metadata?: string;
  numParticipants?: number;
  numPublishers?: number;
  activeRecording?: boolean;
  sharedState?: Record<string, string>;
}

export enum ParticipantKind {
  Standard = 0,
  Ingress = 1,
  Egress = 2,
  Sip = 3,
  Agent = 4,
}

export interface ParticipantPermission {
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  canPublishSources: TrackSource[];
  canUpdateMetadata: boolean;
  canManageGroups: boolean;
  hidden: boolean;
  recorder: boolean;
  agent: boolean;
}

export interface ParticipantInfo {
  sid: string;
  identity: string;
  name?: string;
  metadata?: string;
  state: ParticipantState;
  tracks?: TrackInfo[];
  attributes?: Record<string, string>;
  kind?: ParticipantKind;
  joinedAt?: number;
  disconnectReason?: DisconnectReason;
  permission?: ParticipantPermission;
  groupId?: string;
  /** @internal Node that hosts this participant (used for cross-node sync). */
  nodeId?: string;
}

export interface TrackInfo {
  sid: string;
  name: string;
  kind: TrackKind;
  source: TrackSource;
  muted: boolean;
  width?: number;
  height?: number;
  layers?: VideoLayer[];
  appData?: Record<string, unknown>;
}

export interface DataTrackInfo {
  sid: string;
  name: string;
  label: string;
  protocol: string;
  appData?: Record<string, unknown>;
}

export interface VideoLayer {
  quality: VideoQuality;
  width: number;
  height: number;
  bitrate: number;
  ssrc?: number;
}

// --- Client Info ---

export interface ClientInfo {
  sdk: number;
  version: string;
  protocol: number;
}

export interface ConnectionSettings {
  autoSubscribe: boolean;
  adaptiveStream: boolean;
  dtlsFingerprints?: DtlsFingerprint[];
}

// --- Join / Connect ---

export interface JoinRequest {
  room: { name: string; metadata?: string };
  clientInfo: ClientInfo;
  connectionSettings: ConnectionSettings;
  reconnect: boolean;
  participantSid: string;
  nodeId: string;
  token?: string;
  refreshToken?: string;
}

export interface JoinResponse {
  room: RoomInfo;
  participant: ParticipantInfo;
  pingTimeout: number;
  pingInterval: number;
  statsInterval?: number;
  serverInfo: ServerInfo;
  iceServers: RTCIceServer[];
  sendTransport: TransportParams;
  receiveTransport: TransportParams;
  signal: SignalChannels;
  rtpCapabilities: mediasoupTypes.RtpCapabilities;
  otherParticipants?: ParticipantInfo[];
  fullReconnect?: boolean;
  refreshToken?: string;
  iceTransportPolicy?: RTCIceTransportPolicy;
}

export interface TokenRefreshedNotification {
  token: string;
}

export interface ReconnectResponse {
  iceParameters: Record<string, IceParameters>;
}

export interface ConnectRequest {
  nodeId: string;
  participantSid: string;
  transports: TransportConnectInfo[];
  token?: string;
}

export interface TransportConnectInfo {
  transportSid: string;
  dtlsParameters: DtlsParameters;
}

// --- SyncState (for reconnect) ---

export interface SyncState {
  subscribedTrackSids: string[];
  subscribedDataTrackSids: string[];
  publishedTrackSids: string[];
  dataReceiveStates: DataReceiveState[];
  /** Timestamp of the last chat message the client received before disconnect. */
  lastMessageTimestamp?: number;
}

export interface DataReceiveState {
  dataTrackSid: string;
  lastSeq: number;
}

// --- RPC Request/Response Bodies ---

export interface ReadyRequest {
  rtpCapabilities: mediasoupTypes.RtpCapabilities;
  syncState?: SyncState;
}

export interface ReadyResponse {
  otherParticipants: ParticipantInfo[];
  room?: RoomInfo;
  groups?: GroupInfo[];
  messages?: MessageInfo[];
  sharedState?: Record<string, string>;
}

export interface MessageInfo {
  id: string;
  type?: string;
  message: string;
  timestamp: number;
  editTimestamp?: number;
  transient?: boolean;
  participantSid?: string;
  participantIdentity?: string;
}

/** @deprecated Use {@link MessageInfo} instead. */
export type ChatMessageInfo = MessageInfo;

export interface MessageDeletedNotification {
  ids: string[];
  type?: string;
}

export interface StateUpdatedNotification {
  key: string;
  value: string;
  participantSid?: string;
  participantIdentity?: string;
}

export interface StateDeletedNotification {
  key: string;
  participantSid?: string;
  participantIdentity?: string;
}

export interface LeaveRequest {
  reason?: string;
}

export interface PingRequest {
  timestamp: number;
}

export interface PingResponse {
  lastTimestamp: number;
  serverTime: number;
}

export interface TrackPublishRequest {
  clientTrackId: string;
  name: string;
  kind: TrackKind;
  rtpParameters: mediasoupTypes.RtpParameters;
  source: TrackSource;
  width?: number;
  height?: number;
  muted: boolean;
  videoCodec?: string;
  backupCodec?: string;
  backupCodecPolicy?: number;
  layers?: VideoLayer[];
  appData?: Record<string, unknown>;
}

export interface PublishBackupTrackRequest {
  trackSid: string;
  clientTrackId: string;
  rtpParameters: mediasoupTypes.RtpParameters;
}

export interface PublishBackupTrackResponse {
  backupTrackSid: string;
}

export interface TrackPublishResponse {
  trackSid: string;
}

export interface TrackUnpublishRequest {
  trackSid: string;
}

export interface TrackMuteRequest {
  trackSid: string;
  muted: boolean;
}

export interface TrackUpdateRequest {
  trackSid: string;
  width?: number;
  height?: number;
  layers?: VideoLayer[];
}

export interface DataTrackPublishRequest {
  clientTrackId: string;
  transportSid: string;
  sctpStreamParameters: SctpStreamParameters;
  name: string;
  label: string;
  protocol: string;
  appData?: Record<string, unknown>;
}

export interface DataTrackPublishResponse {
  dataTrackSid: string;
}

export interface DataTrackUnpublishRequest {
  dataTrackSid: string;
}

export interface SubscriptionActionRequest {
  subscriptionSid: string;
}

export interface SubscriptionSetLayersRequest {
  subscriptionSid: string;
  spatialLayer: number;
  temporalLayer?: number;
}

export interface SubscriptionSetPriorityRequest {
  subscriptionSid: string;
  priority: number;
}

export interface DataSubscriptionCloseRequest {
  dataSubscriptionSid: string;
}

export interface TransportGetStatsRequest {
  transportSid: string;
}

export interface ParticipantUpdateRequest {
  metadata?: string;
  name?: string;
  attributes?: Record<string, string>;
}

export interface ParticipantTrackPermission {
  /** The participant identity this permission applies to. */
  participantIdentity?: string;
  /** The participant server id this permission applies to. */
  participantSid?: string;
  /** Grant permission to all tracks. Takes precedence over allowedTrackSids. */
  allowAll?: boolean;
  /** List of track sids the target participant can subscribe to. */
  allowedTrackSids?: string[];
}

export interface UpdateSubscriptionPermissionsRequest {
  allParticipantsAllowed: boolean;
  trackPermissions: ParticipantTrackPermission[];
}

// --- Server → Client RPC ---

export interface SubscriptionCreateRequest {
  subscriptionSid: string;
  trackSid: string;
  trackName: string;
  trackSource: TrackSource;
  publisherSid: string;
  kind: TrackKind;
  rtpParameters: mediasoupTypes.RtpParameters;
  subscriptionType?: string;
  trackMuted: boolean;
  appData?: Record<string, unknown>;
}

export interface DataSubscriptionCreateRequest {
  dataSubscriptionSid: string;
  dataTrackSid: string;
  publisherSid: string;
  sctpStreamParameters: SctpStreamParameters;
  label: string;
  protocol: string;
  appData?: Record<string, unknown>;
}

// --- Server → Client Notifications ---

export interface SubscriptionClosedNotification {
  subscriptionSid: string;
}

export interface DataSubscriptionClosedNotification {
  dataSubscriptionSid: string;
}

export interface ParticipantJoinedNotification {
  participant: ParticipantInfo;
}

export interface ParticipantLeftNotification {
  participantSid: string;
  reason?: string;
}

export interface ParticipantUpdatedNotification {
  participant: ParticipantInfo;
}

export interface TrackPublishedNotification {
  participantSid: string;
  track: TrackInfo;
}

export interface TrackUnpublishedNotification {
  participantSid: string;
  trackSid: string;
}

export interface TrackMutedNotification {
  participantSid: string;
  trackSid: string;
  muted: boolean;
}

export interface SubscribedQualityInfo {
  quality: VideoQuality;
  enabled: boolean;
}

export interface SubscribedCodecInfo {
  codec: string;
  qualities: SubscribedQualityInfo[];
}

export interface TrackSubscribedQualityChangedNotification {
  trackSid: string;
  subscribedQualities: SubscribedQualityInfo[];
  subscribedCodecs?: SubscribedCodecInfo[];
}

export interface TrackSubscriptionStatusChangedNotification {
  trackSid: string;
  hasSubscribers: boolean;
}

export interface ActiveSpeaker {
  participantSid: string;
  level: number;
  active: boolean;
}

export interface ActiveSpeakersChangedNotification {
  speakers: ActiveSpeaker[];
}

export interface RoomUpdatedNotification {
  room: RoomInfo;
}

export interface DisconnectNotification {
  reason: DisconnectReason;
}

// ============================================================
// Group (Breakout Room) Types
// ============================================================

export interface GroupInfo {
  groupId: string;
  name: string;
  permissions?: ParticipantPermission;
  participantCount: number;
}

export interface CreateGroupRequest {
  name: string;
  permissions?: ParticipantPermission;
}

export interface CreateGroupResponse {
  group: GroupInfo;
}

export interface DeleteGroupRequest {
  groupId: string;
}

export interface ListGroupsResponse {
  groups: GroupInfo[];
}

export interface JoinGroupRequest {
  groupId: string;
}

export interface JoinGroupResponse {
  otherParticipants: ParticipantInfo[];
}

export interface GroupCreatedNotification {
  group: GroupInfo;
}

export interface GroupDeletedNotification {
  groupId: string;
}

export interface GroupParticipantJoinedNotification {
  groupId: string;
  participantSid: string;
}

export interface GroupParticipantLeftNotification {
  groupId: string;
  participantSid: string;
}
