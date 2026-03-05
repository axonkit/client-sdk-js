// Core
export { Room } from './Room';
export type { RoomEvents } from './Room';

// Participants
export { Participant } from './participant/Participant';
export type { TrackPublication, ParticipantEvents } from './participant/Participant';
export { LocalParticipant } from './participant/LocalParticipant';
export { RemoteParticipant } from './participant/RemoteParticipant';

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

// Options
export type {
  RoomOptions,
  TrackPublishOptions,
  DataPublishOptions,
  VideoCaptureOptions,
  AudioCaptureOptions,
  ScreenShareCaptureOptions,
  VideoEncoding,
  VideoResolution,
  CreateLocalTracksOptions,
  ReconnectPolicy,
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

// Utilities
export { setLogLevel, setLogger, LogLevel } from './utils/logger';
export type { LoggerInterface } from './utils/logger';
export { TypedEventEmitter } from './utils/events';

// Version
export { VERSION, PROTOCOL_VERSION } from './version';
