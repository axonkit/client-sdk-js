import type { TrackSource } from '../protocol/types';

// ---------------------------------------------------------------------------
// Video capture
// ---------------------------------------------------------------------------

/**
 * Options for capturing video from a camera device.
 */
export interface VideoCaptureOptions {
  /**
   * A ConstrainDOMString specifying a device ID or an array of device IDs
   * which are acceptable and/or required.
   */
  deviceId?: ConstrainDOMString;

  /**
   * A ConstrainDouble specifying the frame rate or range of frame rates
   * which are acceptable and/or required.
   */
  frameRate?: ConstrainDouble;

  /**
   * A facing or an array of facings which are acceptable and/or required.
   */
  facingMode?: 'user' | 'environment' | 'left' | 'right';

  /**
   * Target capture resolution.
   */
  resolution?: VideoResolution;
}

/**
 * Video resolution descriptor.
 */
export interface VideoResolution {
  width: number;
  height: number;
  frameRate?: number;
  aspectRatio?: number;
}

// ---------------------------------------------------------------------------
// Audio capture
// ---------------------------------------------------------------------------

/**
 * Options for capturing audio from a microphone device.
 */
export interface AudioCaptureOptions {
  /**
   * Specifies whether automatic gain control is preferred and/or required.
   */
  autoGainControl?: ConstrainBoolean;

  /**
   * The channel count or range of channel counts which are acceptable
   * and/or required.
   */
  channelCount?: ConstrainULong;

  /**
   * A ConstrainDOMString specifying a device ID or an array of device IDs
   * which are acceptable and/or required.
   */
  deviceId?: ConstrainDOMString;

  /**
   * Whether or not echo cancellation is preferred and/or required.
   */
  echoCancellation?: ConstrainBoolean;

  /**
   * The latency or range of latencies which are acceptable and/or required.
   */
  latency?: ConstrainDouble;

  /**
   * Whether noise suppression is preferred and/or required.
   */
  noiseSuppression?: ConstrainBoolean;

  /**
   * @experimental
   * A stronger version of `noiseSuppression`; browser support is not
   * widespread yet. When set (and supported) the value for
   * `noiseSuppression` will be ignored.
   *
   * @see https://w3c.github.io/mediacapture-extensions/#voiceisolation-constraint
   */
  voiceIsolation?: ConstrainBoolean;

  /**
   * The sample rate or range of sample rates which are acceptable
   * and/or required.
   */
  sampleRate?: ConstrainULong;

  /**
   * The sample size or range of sample sizes which are acceptable
   * and/or required.
   */
  sampleSize?: ConstrainULong;
}

/**
 * Options for audio output device selection.
 *
 * Only supported on browsers where `setSinkId` is available.
 */
export interface AudioOutputOptions {
  /**
   * Device ID to route audio output to.
   */
  deviceId?: string;
}

// ---------------------------------------------------------------------------
// Screen share capture
// ---------------------------------------------------------------------------

/**
 * Options for capturing a screen share.
 */
export interface ScreenShareCaptureOptions {
  /**
   * `true` to capture audio shared alongside the screen. Browser support for
   * audio capturing in screen share is limited.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia#browser_compatibility
   */
  audio?: boolean | AudioCaptureOptions;

  /**
   * `true` to capture video. Chrome allows additional options.
   *
   * @see https://developer.chrome.com/docs/web-platform/screen-sharing-controls/#displaySurface
   */
  video?: true | { displaySurface?: 'window' | 'browser' | 'monitor' };

  /**
   * Capture resolution. Defaults to 1080 for most browsers.
   */
  resolution?: VideoResolution;

  /**
   * Target frame rate for the screen share capture.
   */
  frameRate?: number;

  /**
   * Specifies whether the browser should allow the user to select the
   * current tab for capture.
   */
  selfBrowserSurface?: 'include' | 'exclude';

  /**
   * Specifies whether the browser should display a control to allow the user
   * to dynamically switch the shared tab during screen-sharing.
   */
  surfaceSwitching?: 'include' | 'exclude';

  /**
   * Specifies whether the browser should include the system audio among the
   * possible audio sources offered to the user.
   */
  systemAudio?: 'include' | 'exclude';

  /**
   * Specify the type of content.
   *
   * @see https://www.w3.org/TR/mst-content-hint/#video-content-hints
   */
  contentHint?: 'detail' | 'text' | 'motion';

  /**
   * @experimental
   * Controls whether the audio playing in a tab will continue to be played
   * out of a user's local speakers when the tab is captured.
   */
  suppressLocalAudioPlayback?: boolean;

  /**
   * @experimental
   * Instructs the browser to offer the current tab as the most prominent
   * capture source.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia#prefercurrenttab
   */
  preferCurrentTab?: boolean;

  /**
   * A CaptureController instance for further manipulation of the capture
   * session if included.
   */
  controller?: unknown;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * Video encoding parameters.
 */
export interface VideoEncoding {
  maxBitrate: number;
  maxFramerate?: number;
  priority?: RTCPriorityType;
}

/**
 * Audio preset defining the maximum bitrate and optional priority.
 */
export interface AudioPreset {
  maxBitrate: number;
  priority?: RTCPriorityType;
}

// ---------------------------------------------------------------------------
// Video preset
// ---------------------------------------------------------------------------

/**
 * Options accepted by the {@link VideoPreset} constructor.
 */
export interface VideoPresetOptions {
  width: number;
  height: number;
  aspectRatio?: number;
  maxBitrate: number;
  maxFramerate?: number;
  priority?: RTCPriorityType;
}

/**
 * Encapsulates a video resolution together with its target encoding
 * parameters. Used for simulcast layers and default presets.
 */
export class VideoPreset {
  encoding: VideoEncoding;
  width: number;
  height: number;
  aspectRatio?: number;

  constructor(options: VideoPresetOptions);
  constructor(
    width: number,
    height: number,
    maxBitrate: number,
    maxFramerate?: number,
    priority?: RTCPriorityType,
  );
  constructor(
    widthOrOptions: number | VideoPresetOptions,
    height?: number,
    maxBitrate?: number,
    maxFramerate?: number,
    priority?: RTCPriorityType,
  ) {
    if (typeof widthOrOptions === 'object') {
      this.width = widthOrOptions.width;
      this.height = widthOrOptions.height;
      this.aspectRatio = widthOrOptions.aspectRatio;
      this.encoding = {
        maxBitrate: widthOrOptions.maxBitrate,
        maxFramerate: widthOrOptions.maxFramerate,
        priority: widthOrOptions.priority,
      };
    } else if (height !== undefined && maxBitrate !== undefined) {
      this.width = widthOrOptions;
      this.height = height;
      this.aspectRatio = widthOrOptions / height;
      this.encoding = {
        maxBitrate,
        maxFramerate,
        priority,
      };
    } else {
      throw new TypeError('Unsupported options: provide at least width, height and maxBitrate');
    }
  }

  /** Convenience getter that returns a {@link VideoResolution} from this preset. */
  get resolution(): VideoResolution {
    return {
      width: this.width,
      height: this.height,
      frameRate: this.encoding.maxFramerate,
      aspectRatio: this.aspectRatio,
    };
  }
}

// ---------------------------------------------------------------------------
// Codec types
// ---------------------------------------------------------------------------

/** `red` is not technically a codec but treated as one in signalling. */
export const audioCodecs = ['opus', 'red'] as const;

/** Audio codec identifier. */
export type AudioCodec = (typeof audioCodecs)[number];

const backupVideoCodecs = ['vp8', 'h264'] as const;

/** All supported video codecs. */
export const videoCodecs = ['vp8', 'h264', 'vp9', 'av1', 'h265'] as const;

/** Video codec identifier. */
export type VideoCodec = (typeof videoCodecs)[number];

/** Subset of video codecs that can serve as a backup codec. */
export type BackupVideoCodec = (typeof backupVideoCodecs)[number];

/**
 * Returns `true` if the given codec string is a valid backup video codec.
 */
export function isBackupVideoCodec(codec: string): codec is BackupVideoCodec {
  return backupVideoCodecs.includes(codec as BackupVideoCodec);
}

/**
 * Policy for handling backup codec behaviour when the primary codec is an
 * advanced codec (VP9 / AV1 / H265).
 */
export enum BackupCodecPolicy {
  /**
   * Codec regression is preferred — the SFU will try to regress codec if
   * possible but it is not guaranteed.
   */
  PREFER_REGRESSION = 0,
  /** Multi-codec simulcast: publish both primary and backup codec simultaneously. */
  SIMULCAST = 1,
  /** Always use backup codec only. */
  REGRESSION = 2,
}

// ---------------------------------------------------------------------------
// SVC scalability modes
// ---------------------------------------------------------------------------

/**
 * Scalability modes for SVC (Scalable Video Coding).
 *
 * @see https://www.w3.org/TR/webrtc-svc/#scalabilitymodes
 */
export type ScalabilityMode =
  | 'L1T1'
  | 'L1T2'
  | 'L1T3'
  | 'L2T1'
  | 'L2T1h'
  | 'L2T1_KEY'
  | 'L2T2'
  | 'L2T2h'
  | 'L2T2_KEY'
  | 'L2T3'
  | 'L2T3h'
  | 'L2T3_KEY'
  | 'L3T1'
  | 'L3T1h'
  | 'L3T1_KEY'
  | 'L3T2'
  | 'L3T2h'
  | 'L3T2_KEY'
  | 'L3T3'
  | 'L3T3h'
  | 'L3T3_KEY';

// ---------------------------------------------------------------------------
// Publish codec options (mediasoup ProducerCodecOptions)
// ---------------------------------------------------------------------------

/**
 * Codec-specific options forwarded to the mediasoup producer.
 *
 * These map directly to the SDP `fmtp` parameters for the selected codec.
 */
export interface PublishCodecOptions {
  opusStereo?: boolean;
  opusFec?: boolean;
  opusDtx?: boolean;
  opusMaxPlaybackRate?: number;
  opusMaxAverageBitrate?: number;
  opusPtime?: number;
  opusNack?: boolean;
  videoGoogleStartBitrate?: number;
  videoGoogleMaxBitrate?: number;
  videoGoogleMinBitrate?: number;
}

// ---------------------------------------------------------------------------
// Track publish defaults & options
// ---------------------------------------------------------------------------

/**
 * Default parameters applied when publishing a track. These can be set once
 * on {@link RoomOptions.publishDefaults} and will be used for every subsequent
 * publish call unless overridden per-track.
 */
export interface TrackPublishDefaults {
  /**
   * Encoding parameters for camera track.
   */
  videoEncoding?: VideoEncoding;

  /**
   * Advanced codecs (VP9 / AV1 / H265) are not supported by all browser
   * clients. When `backupCodec` is set and an incompatible client attempts
   * to subscribe, the server will automatically publish a secondary track
   * encoded with the backup codec.
   *
   * You can customize the encoding parameters of the backup track by
   * explicitly setting codec and encoding fields.
   *
   * @defaultValue `true`
   */
  backupCodec?: true | false | { codec: BackupVideoCodec; encoding?: VideoEncoding };

  /**
   * Policy for deciding whether to send the primary codec at the same time
   * as the backup codec.
   *
   * @see {@link BackupCodecPolicy}
   */
  backupCodecPolicy?: BackupCodecPolicy;

  /**
   * Encoding parameters for screen share tracks.
   */
  screenShareEncoding?: VideoEncoding;

  /**
   * Video codec, defaults to `'vp8'`. For SVC codecs, auto-enable `'vp8'`
   * as backup.
   */
  videoCodec?: VideoCodec;

  /**
   * Which audio preset should be used for publishing audio tracks.
   *
   * @defaultValue {@link AudioPresets.music}
   */
  audioPreset?: AudioPreset;

  /**
   * DTX (Discontinuous Transmission of audio). Enabled by default for mono
   * tracks.
   */
  dtx?: boolean;

  /**
   * RED (Redundant Audio Data). Enabled by default for mono tracks.
   */
  red?: boolean;

  /**
   * Publish track in stereo mode (or set to `false` to disable). Default is
   * determined by the capture channel count.
   */
  forceStereo?: boolean;

  /**
   * Use simulcast. Defaults to `true`.
   *
   * When using simulcast, the SDK will publish up to three versions of the
   * stream at various resolutions.
   */
  simulcast?: boolean;

  /**
   * Scalability mode for SVC codecs, defaults to `'L3T3_KEY'`.
   * When an SVC codec is used, simulcast is disabled.
   */
  scalabilityMode?: ScalabilityMode;

  /**
   * Degradation preference hint for the browser encoder.
   */
  degradationPreference?: RTCDegradationPreference;

  /**
   * Up to two additional simulcast layers to publish in addition to the
   * original track.
   *
   * When left blank, it defaults to `[VideoPresets.h180, VideoPresets.h360]`.
   * If an SVC codec is used (VP9 or AV1), this field has no effect.
   *
   * @example
   * ```ts
   * {
   *   videoEncoding: { maxBitrate: 1_700_000, maxFramerate: 30 },
   *   videoSimulcastLayers: [VideoPresets.h540, VideoPresets.h216],
   * }
   * ```
   */
  videoSimulcastLayers?: VideoPreset[];

  /**
   * Custom simulcast layers for screen share tracks.
   *
   * Note: layers should be ordered from lowest to highest quality.
   */
  screenShareSimulcastLayers?: VideoPreset[];

  /**
   * For local tracks, stop the underlying `MediaStreamTrack` when the track
   * is muted (or paused). On some platforms this is necessary to disable the
   * microphone recording indicator.
   *
   * Note: when enabled with Bluetooth devices connected, they will
   * transition between profiles (e.g. HFP to A2DP) causing an audible
   * difference in playback.
   *
   * @defaultValue `false`
   */
  stopMicTrackOnMute?: boolean;

  /**
   * Codec-specific options forwarded to the underlying mediasoup producer.
   *
   * @see {@link PublishCodecOptions}
   */
  codecOptions?: PublishCodecOptions;

  /**
   * Whether the mediasoup producer should stop the `MediaStreamTrack` when
   * the producer is closed.
   */
  stopTracks?: boolean;

  /**
   * Whether to disable (mute) the `MediaStreamTrack` when the producer is
   * paused.
   */
  disableTrackOnPause?: boolean;

  /**
   * Whether to send zero RTP when the producer is paused, instead of
   * disabling the track.
   */
  zeroRtpOnPause?: boolean;
}

/**
 * Options when publishing tracks. Extends {@link TrackPublishDefaults} with
 * per-track metadata.
 */
export interface TrackPublishOptions extends TrackPublishDefaults {
  /**
   * A human-readable name for the track.
   */
  name?: string;

  /**
   * Source of track — camera, microphone, or screen.
   */
  source?: TrackSource;

  /**
   * Set a stream name for the track. Audio and video tracks with the same
   * stream name will be placed in the same `MediaStream` and offer better
   * synchronisation.
   *
   * By default, camera and microphone are placed in one stream; screen share
   * video and audio in another.
   */
  stream?: string;

  /**
   * Target audio bitrate in bits per second.
   */
  audioBitrate?: number;
}

// ---------------------------------------------------------------------------
// Data publish options
// ---------------------------------------------------------------------------

/**
 * Options for publishing data via a DataChannel.
 */
export interface DataPublishOptions {
  /** A human-readable name for the data track. */
  name?: string;
  /** DataChannel label. */
  label?: string;
  /** Whether messages should be delivered in order. */
  ordered?: boolean;
  /** Maximum number of retransmissions. */
  maxRetransmits?: number;
  /** Maximum packet lifetime in milliseconds. */
  maxPacketLifeTime?: number;
}

// ---------------------------------------------------------------------------
// Local track creation
// ---------------------------------------------------------------------------

/**
 * Options accepted by {@link createLocalTracks}.
 */
export interface CreateLocalTracksOptions {
  /**
   * Audio track options. `true` to create with defaults, `false` to skip.
   *
   * @defaultValue `true`
   */
  audio?: boolean | AudioCaptureOptions;

  /**
   * Video track options. `true` to create with defaults, `false` to skip.
   *
   * @defaultValue `true`
   */
  video?: boolean | VideoCaptureOptions;
}

// ---------------------------------------------------------------------------
// Adaptive stream
// ---------------------------------------------------------------------------

/**
 * Configuration for the adaptive stream feature. When enabled the SDK
 * automatically manages video subscription quality based on element
 * visibility and dimensions.
 */
export interface AdaptiveStreamSettings {
  /**
   * Pixel density to use when computing the required video resolution.
   * Set to `'screen'` to use `window.devicePixelRatio`.
   *
   * @defaultValue `1`
   */
  pixelDensity?: number | 'screen';

  /**
   * Pause video subscriptions when the browser tab is hidden.
   *
   * @defaultValue `true`
   */
  pauseVideoInBackground?: boolean;
}

// ---------------------------------------------------------------------------
// Room options
// ---------------------------------------------------------------------------

/**
 * Top-level options for a {@link Room} instance.
 */
export interface RoomOptions {
  /**
   * Automatically manage subscribed video quality based on the size and
   * visibility of attached elements. Pass `true` to enable with defaults
   * or provide {@link AdaptiveStreamSettings} for fine-grained control.
   */
  adaptiveStream?: boolean | AdaptiveStreamSettings;

  /**
   * Enable Dynacast — dynamically pause video layers that have no
   * subscribers on the server.
   */
  dynacast?: boolean;

  /**
   * Automatically subscribe to tracks when participants join.
   *
   * @defaultValue `true`
   */
  autoSubscribe?: boolean;

  /**
   * Default capture options used when creating camera tracks.
   */
  videoCaptureDefaults?: VideoCaptureOptions;

  /**
   * Default capture options used when creating microphone tracks.
   */
  audioCaptureDefaults?: AudioCaptureOptions;

  /**
   * Default publish parameters applied to every track unless overridden
   * per-track.
   */
  publishDefaults?: TrackPublishDefaults;

  /**
   * Whether to stop local tracks when they are unpublished.
   *
   * @defaultValue `true`
   */
  stopLocalTrackOnUnpublish?: boolean;

  /**
   * Policy parameters for automatic reconnection.
   */
  reconnectPolicy?: ReconnectPolicy;

  /**
   * Disconnect from the room when the user navigates away from the page
   * (via the `beforeunload` event).
   *
   * @defaultValue `true`
   */
  disconnectOnPageLeave?: boolean;

  /**
   * Room name sent in the JoinRequest for server-side routing and room
   * creation. Required when using load-balanced deployments.
   */
  roomName?: string;

  /**
   * Room metadata (e.g. meeting topic) sent in the JoinRequest when the
   * room is first created.
   */
  metadata?: string;
}

/**
 * Policy parameters governing automatic reconnection behaviour.
 */
export interface ReconnectPolicy {
  /** Maximum number of reconnection attempts. */
  maxRetries?: number;
  /** Maximum delay between reconnection attempts in milliseconds. */
  maxDelay?: number;
  /** Initial delay before the first reconnection attempt in milliseconds. */
  initialDelay?: number;
}

// =========================================================================
// Default values & presets
// =========================================================================

/**
 * Default camera capture options: 720p @ 30 fps.
 */
export const defaultVideoCaptureOptions: VideoCaptureOptions = {
  resolution: { width: 1280, height: 720 },
  frameRate: 30,
};

/**
 * Default microphone capture options with echo cancellation, noise
 * suppression and automatic gain control enabled.
 */
export const defaultAudioCaptureOptions: AudioCaptureOptions = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Default video encoding: 720p @ 30 fps, 1.7 Mbps.
 */
export const defaultVideoEncoding: VideoEncoding = {
  maxBitrate: 1_700_000,
  maxFramerate: 30,
};

/**
 * Default screen share encoding: 1080p @ 30 fps, 3 Mbps.
 */
export const defaultScreenShareEncoding: VideoEncoding = {
  maxBitrate: 3_000_000,
  maxFramerate: 30,
};

// ---------------------------------------------------------------------------
// Audio presets
// ---------------------------------------------------------------------------

/**
 * Pre-defined audio encoding presets.
 */
export const AudioPresets = {
  /** 12 kbps — suitable for telephone-quality speech. */
  telephone: { maxBitrate: 12_000 } as AudioPreset,
  /** 24 kbps — good quality speech. */
  speech: { maxBitrate: 24_000 } as AudioPreset,
  /** 48 kbps — music quality (mono). */
  music: { maxBitrate: 48_000 } as AudioPreset,
  /** 64 kbps — music quality (stereo). */
  musicStereo: { maxBitrate: 64_000 } as AudioPreset,
  /** 96 kbps — high quality music (mono). */
  musicHighQuality: { maxBitrate: 96_000 } as AudioPreset,
  /** 128 kbps — high quality music (stereo). */
  musicHighQualityStereo: { maxBitrate: 128_000 } as AudioPreset,
} as const;

// ---------------------------------------------------------------------------
// Video presets (16:9)
// ---------------------------------------------------------------------------

/**
 * Pre-defined 16 : 9 video resolution / encoding presets.
 */
export const VideoPresets = {
  h90: new VideoPreset(160, 90, 90_000, 20),
  h180: new VideoPreset(320, 180, 160_000, 20),
  h216: new VideoPreset(384, 216, 180_000, 20),
  h360: new VideoPreset(640, 360, 450_000, 20),
  h540: new VideoPreset(960, 540, 800_000, 25),
  h720: new VideoPreset(1280, 720, 1_700_000, 30),
  h1080: new VideoPreset(1920, 1080, 3_000_000, 30),
  h1440: new VideoPreset(2560, 1440, 5_000_000, 30),
  h2160: new VideoPreset(3840, 2160, 8_000_000, 30),
} as const;

// ---------------------------------------------------------------------------
// Video presets (4:3)
// ---------------------------------------------------------------------------

/**
 * Pre-defined 4 : 3 video resolution / encoding presets.
 */
export const VideoPresets43 = {
  h120: new VideoPreset(160, 120, 70_000, 20),
  h180: new VideoPreset(240, 180, 125_000, 20),
  h240: new VideoPreset(320, 240, 140_000, 20),
  h360: new VideoPreset(480, 360, 330_000, 20),
  h480: new VideoPreset(640, 480, 500_000, 20),
  h540: new VideoPreset(720, 540, 600_000, 25),
  h720: new VideoPreset(960, 720, 1_300_000, 30),
  h1080: new VideoPreset(1440, 1080, 2_300_000, 30),
  h1440: new VideoPreset(1920, 1440, 3_800_000, 30),
} as const;

// ---------------------------------------------------------------------------
// Screen share presets
// ---------------------------------------------------------------------------

/**
 * Pre-defined screen share resolution / encoding presets.
 */
export const ScreenSharePresets = {
  h360fps3: new VideoPreset(640, 360, 200_000, 3, 'medium'),
  h360fps15: new VideoPreset(640, 360, 400_000, 15, 'medium'),
  h720fps5: new VideoPreset(1280, 720, 800_000, 5, 'medium'),
  h720fps15: new VideoPreset(1280, 720, 1_500_000, 15, 'medium'),
  h720fps30: new VideoPreset(1280, 720, 2_000_000, 30, 'medium'),
  h1080fps15: new VideoPreset(1920, 1080, 2_500_000, 15, 'medium'),
  h1080fps30: new VideoPreset(1920, 1080, 5_000_000, 30, 'medium'),
  /** Original resolution, no resizing applied. */
  original: new VideoPreset(0, 0, 7_000_000, 30, 'medium'),
} as const;

// ---------------------------------------------------------------------------
// Simulcast presets (kept for internal use)
// ---------------------------------------------------------------------------

/**
 * Simulcast encoding presets used internally for building default
 * simulcast layers.
 */
export const videoSimulcastPresets = {
  h180: VideoPresets.h180.encoding,
  h360: VideoPresets.h360.encoding,
  h720: VideoPresets.h720.encoding,
  h1080: VideoPresets.h1080.encoding,
};
