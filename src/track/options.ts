import { TrackSource } from '../protocol/types';

export interface VideoCaptureOptions {
  resolution?: VideoResolution;
  frameRate?: number;
  facingMode?: 'user' | 'environment';
  deviceId?: string;
}

export interface VideoResolution {
  width: number;
  height: number;
}

export interface AudioCaptureOptions {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  deviceId?: string;
  channelCount?: number;
  sampleRate?: number;
}

export interface ScreenShareCaptureOptions {
  audio?: boolean | AudioCaptureOptions;
  resolution?: VideoResolution;
  frameRate?: number;
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  systemAudio?: 'include' | 'exclude';
}

export interface TrackPublishOptions {
  name?: string;
  source?: TrackSource;
  simulcast?: boolean;
  videoEncoding?: VideoEncoding;
  videoCodec?: string;
  audioBitrate?: number;
  dtx?: boolean;
  red?: boolean;
  stopMicTrackOnMute?: boolean;
}

export interface VideoEncoding {
  maxBitrate: number;
  maxFramerate?: number;
}

export interface DataPublishOptions {
  name?: string;
  label?: string;
  ordered?: boolean;
  maxRetransmits?: number;
  maxPacketLifeTime?: number;
}

export interface CreateLocalTracksOptions {
  audio?: boolean | AudioCaptureOptions;
  video?: boolean | VideoCaptureOptions;
}

export interface RoomOptions {
  adaptiveStream?: boolean;
  dynacast?: boolean;
  autoSubscribe?: boolean;
  videoCaptureDefaults?: VideoCaptureOptions;
  audioCaptureDefaults?: AudioCaptureOptions;
  publishDefaults?: TrackPublishOptions;
  stopLocalTrackOnUnpublish?: boolean;
  reconnectPolicy?: ReconnectPolicy;
  disconnectOnPageLeave?: boolean;
}

export interface ReconnectPolicy {
  maxRetries?: number;
  maxDelay?: number;
  initialDelay?: number;
}

export const defaultVideoCaptureOptions: VideoCaptureOptions = {
  resolution: { width: 1280, height: 720 },
  frameRate: 30,
};

export const defaultAudioCaptureOptions: AudioCaptureOptions = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export const defaultVideoEncoding: VideoEncoding = {
  maxBitrate: 1_700_000,
  maxFramerate: 30,
};

export const videoSimulcastPresets = {
  h180: { maxBitrate: 125_000, maxFramerate: 15 } as VideoEncoding,
  h360: { maxBitrate: 400_000, maxFramerate: 20 } as VideoEncoding,
  h720: { maxBitrate: 1_700_000, maxFramerate: 30 } as VideoEncoding,
  h1080: { maxBitrate: 3_000_000, maxFramerate: 30 } as VideoEncoding,
};
