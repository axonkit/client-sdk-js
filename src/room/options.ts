import type {
  VideoCaptureOptions,
  AudioCaptureOptions,
  TrackPublishDefaults,
} from '../track/options';

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
   * Automatically stop local tracks when they are unpublished, including
   * via {@link LocalParticipant.setCameraEnabled} et al. with `false`.
   * Pass `false` explicitly to {@link LocalParticipant.unpublishTrack} to
   * keep a track alive across unpublish/republish cycles.
   *
   * @defaultValue `true`
   */
  stopLocalTrackOnUnpublish?: boolean;

  /**
   * Room name sent in the JoinRequest for server-side routing and room
   * creation. Optional when the JWT token carries a `room` claim — the
   * server falls back to it. Required for anonymous joins (no token).
   * When both are present they must match.
   */
  roomName?: string;

  /**
   * Room metadata (e.g. meeting topic) sent in the JoinRequest when the
   * room is auto-created. Only takes effect for the first participant
   * that causes the room to be created. Maximum size: 64 KB.
   */
  metadata?: string;

  /**
   * Maximum number of remote participants whose audio/video tracks this
   * client will receive. `0` (default) means receive all participants.
   *
   * When set to a positive number, the server will only auto-subscribe
   * this participant to at most `lastN` publishers' media tracks.
   */
  lastN?: number;
}

// ---------------------------------------------------------------------------
// Room connect options
// ---------------------------------------------------------------------------

/**
 * @internal
 */
export interface InternalRoomConnectOptions {
  /** autosubscribe to room tracks after joining, defaults to true */
  autoSubscribe: boolean;

  /**
   * Timeout in milliseconds for the entire connection handshake — from
   * the initial join request to receiving the ready response.
   * Defaults to 15000 (15 s).
   */
  peerConnectionTimeout: number;

  /**
   * use to override any RTCConfiguration options.
   */
  rtcConfig?: RTCConfiguration;

  /** specifies how often an initial join connection is allowed to retry (only applicable if server is not reachable) */
  maxRetries: number;
}

/**
 * Options for Room.connect()
 */
export type RoomConnectOptions = Partial<InternalRoomConnectOptions>;
