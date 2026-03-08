// Core
export { Room } from './Room';
export type { RoomEvents, ConnectOptions } from './Room';

// Events
export { RoomEvent, ParticipantEvent, TrackEvent } from './events';

// Participants
export { Participant, TrackPublication, SubscriptionStatus } from './participant/Participant';
export type { ParticipantEvents } from './participant/Participant';
export { LocalParticipant } from './participant/LocalParticipant';
export { RemoteParticipant } from './participant/RemoteParticipant';
export { LocalTrackPublication } from './participant/LocalTrackPublication';
export { RemoteTrackPublication } from './participant/RemoteTrackPublication';

// Tracks
export { Track } from './track/Track';
export type { TrackEvents } from './track/Track';
export { LocalTrack } from './track/LocalTrack';
export { LocalAudioTrack } from './track/LocalAudioTrack';
export { LocalVideoTrack } from './track/LocalVideoTrack';
export { RemoteTrack } from './track/RemoteTrack';
export { RemoteAudioTrack } from './track/RemoteAudioTrack';
export { RemoteVideoTrack } from './track/RemoteVideoTrack';

// Track factories
export {
  createLocalTracks,
  createLocalAudioTrack,
  createLocalVideoTrack,
  createLocalScreenTracks,
} from './track/create';

// Track Processor
export type { TrackProcessor, ProcessorOptions } from './track/processor/types';

// Options — types
export type {
  RoomOptions,
  TrackPublishDefaults,
  TrackPublishOptions,
  DataPublishOptions,
  VideoCaptureOptions,
  AudioCaptureOptions,
  ScreenShareCaptureOptions,
  VideoEncoding,
  VideoResolution,
  VideoPresetOptions,
  AudioPreset,
  AudioOutputOptions,
  PublishCodecOptions,
  AdaptiveStreamSettings,
  CreateLocalTracksOptions,
  ReconnectPolicy,
  ScalabilityMode,
  VideoCodec,
  BackupVideoCodec,
  AudioCodec,
} from './track/options';

// Options — values
export {
  VideoPreset,
  BackupCodecPolicy,
  AudioPresets,
  VideoPresets,
  VideoPresets43,
  ScreenSharePresets,
  audioCodecs,
  videoCodecs,
  isBackupVideoCodec,
  defaultVideoCaptureOptions,
  defaultAudioCaptureOptions,
  defaultVideoEncoding,
  defaultScreenShareEncoding,
  videoSimulcastPresets,
} from './track/options';

// Protocol types
export {
  RoomState,
  TrackKind,
  TrackSource,
  VideoQuality,
  DisconnectReason,
  ParticipantState,
  ConnectionQuality,
} from './protocol/types';

export type {
  RoomInfo,
  ServerInfo,
  ParticipantInfo,
  TrackInfo,
  ActiveSpeaker,
  VideoLayer,
  JoinRequest,
  JoinResponse,
  SyncState,
} from './protocol/types';

// Errors
export { AxonError, ConnectionError, TimeoutError, ErrorCode } from './protocol/errors';

// RPC
export { RpcError, MAX_RPC_PAYLOAD_BYTES } from './rpc';

// Types — Chat, Data Stream, RPC
export type {
  ChatMessage,
  SendTextOptions,
  StreamTextOptions,
  StreamBytesOptions,
  SendFileOptions,
  BaseStreamInfo,
  ByteStreamInfo,
  TextStreamInfo,
  PerformRpcParams,
  RpcInvocationData,
} from './types';

// Data Stream Writers
export { TextStreamWriter, ByteStreamWriter } from './data-stream/DataStreamManager';

// Utilities — Logger
export { setLogLevel, setLogger, setLogExtension, LogLevel } from './utils/logger';
export type { LoggerInterface, LogExtension } from './utils/logger';
export { TypedEventEmitter } from './utils/events';

// Utilities — Browser
export {
  isBrowserSupported,
  supportsAdaptiveStream,
  supportsDynacast,
  supportsAV1,
  supportsVP9,
  supportsAudioOutputSelection,
  getBrowser,
  getEmptyAudioStreamTrack,
  getEmptyVideoStreamTrack,
  facingModeFromDeviceLabel,
  facingModeFromLocalTrack,
  createAudioAnalyser,
} from './utils/browser';
export type { BrowserDetails, AudioAnalyserOptions } from './utils/browser';

// Utilities — Device Failure
export { MediaDeviceFailure } from './utils/deviceFailure';
export type { DeviceFailureKind } from './utils/deviceFailure';

// Reconnect Policy
export { DefaultReconnectPolicy } from './room/DefaultReconnectPolicy';
export type { ReconnectContext } from './room/DefaultReconnectPolicy';

// Connection Diagnostics
export { ConnectionCheck, CheckStatus } from './connectionHelper/ConnectionCheck';
export type { CheckInfo } from './connectionHelper/ConnectionCheck';

// Version
export { VERSION, PROTOCOL_VERSION } from './version';
