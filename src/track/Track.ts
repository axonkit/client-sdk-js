import { TypedEventEmitter } from '../utils/events';
import { TrackKind, TrackSource, StreamState } from '../protocol/types';
import { TrackEvent } from '../events';

export interface TrackEvents {
  [TrackEvent.Muted]: (track: Track) => void;
  [TrackEvent.Unmuted]: (track: Track) => void;
  [TrackEvent.Ended]: (track: Track) => void;
  [TrackEvent.ElementAttached]: (element: HTMLMediaElement) => void;
  [TrackEvent.ElementDetached]: (element: HTMLMediaElement) => void;
  [TrackEvent.AudioPlaybackStarted]: () => void;
  [TrackEvent.AudioPlaybackFailed]: (error?: Error) => void;
  [TrackEvent.VideoPlaybackStarted]: () => void;
  [TrackEvent.VideoPlaybackFailed]: (error?: Error) => void;
  [TrackEvent.UpstreamPaused]: (track: Track) => void;
  [TrackEvent.UpstreamResumed]: (track: Track) => void;
  [TrackEvent.VisibilityChanged]: (visible: boolean, track: Track) => void;
  [TrackEvent.VideoDimensionsChanged]: (dimensions: TrackDimensions, track: Track) => void;
  [TrackEvent.AudioSilenceDetected]: () => void;
  [TrackEvent.StreamStateChanged]: (track: Track, streamState: StreamState) => void;
  [TrackEvent.TimeSyncUpdate]: (update: { timestamp: number; rtpTimestamp: number }) => void;
}

const recycledElements: HTMLAudioElement[] = [];

export abstract class Track extends TypedEventEmitter<TrackEvents> {
  kind: TrackKind;
  name: string;
  source: TrackSource;
  sid?: string;
  mediaStreamTrack: MediaStreamTrack;

  private _streamState: StreamState = StreamState.Active;

  attachedElements: HTMLMediaElement[] = [];

  protected _currentBitrate = 0;
  protected monitorInterval?: ReturnType<typeof setInterval>;

  constructor(
    kind: TrackKind,
    name: string,
    source: TrackSource = TrackSource.Unknown,
    mediaStreamTrack: MediaStreamTrack,
  ) {
    super();
    this.kind = kind;
    this.name = name;
    this.source = source;
    this.mediaStreamTrack = mediaStreamTrack;
    mediaStreamTrack.addEventListener('ended', () => {
      this.emit(TrackEvent.Ended, this);
    });
  }

  /** Current bitrate in bits per second, updated by the monitor. */
  get currentBitrate(): number {
    return this._currentBitrate;
  }

  abstract get isLocal(): boolean;

  /**
   * Whether the track is currently muted.
   */
  get isMuted(): boolean {
    return !this.mediaStreamTrack.enabled;
  }

  /**
   * The current stream state of the track.
   * {@link StreamState.Active} means the server is actively forwarding media;
   * {@link StreamState.Paused} means the server has temporarily stopped forwarding (e.g. bandwidth limits).
   * This is separate from `isMuted`, which reflects the publisher's intent.
   */
  get streamState(): StreamState {
    return this._streamState;
  }

  /** @internal */
  setStreamState(state: StreamState): void {
    if (this._streamState === state) return;
    this._streamState = state;
    this.emit(TrackEvent.StreamStateChanged, this, state);
  }

  /** @internal */
  startMonitor(): void {
    // overridden by subclasses
  }

  /** @internal */
  stopMonitor(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
  }

  attach(element?: HTMLMediaElement): HTMLMediaElement {
    if (!element) {
      if (this.kind === TrackKind.Audio) {
        const recycled = recycledElements.find((e) => e.parentElement === null);
        if (recycled) {
          recycledElements.splice(recycledElements.indexOf(recycled), 1);
          element = recycled;
        }
      }
      if (!element) {
        element = document.createElement(this.kind === TrackKind.Audio ? 'audio' : 'video');
      }
      element.autoplay = true;
      if (this.kind === TrackKind.Video) {
        (element as HTMLVideoElement).playsInline = true;
      }
    }

    if (!this.attachedElements.includes(element)) {
      this.attachedElements.push(element);
    }

    const stream = new MediaStream([this.mediaStreamTrack]);
    element.muted = stream.getAudioTracks().length === 0;
    element.srcObject = stream;

    this.emit(TrackEvent.ElementAttached, element);

    const hasAudio = stream.getAudioTracks().length > 0;
    element
      .play()
      .then(() => {
        this.emit(hasAudio ? TrackEvent.AudioPlaybackStarted : TrackEvent.VideoPlaybackStarted);
      })
      .catch((e: Error) => {
        if (e.name === 'NotAllowedError') {
          this.emit(hasAudio ? TrackEvent.AudioPlaybackFailed : TrackEvent.VideoPlaybackFailed, e);
        }
        if (
          hasAudio &&
          element &&
          stream.getVideoTracks().length > 0 &&
          e.name === 'NotAllowedError'
        ) {
          element.muted = true;
          element.play().catch(() => {});
        }
      });

    return element;
  }

  detach(element?: HTMLMediaElement): HTMLMediaElement[] {
    if (element) {
      this.detachElement(element);
      return [element];
    }
    const elements = [...this.attachedElements];
    for (const el of elements) {
      this.detachElement(el);
    }
    return elements;
  }

  private detachElement(element: HTMLMediaElement): void {
    element.srcObject = null;
    const idx = this.attachedElements.indexOf(element);
    if (idx >= 0) {
      this.attachedElements.splice(idx, 1);
    }
    this.recycleElement(element);
    this.emit(TrackEvent.ElementDetached, element);
  }

  private recycleElement(element: HTMLMediaElement): void {
    if (element instanceof HTMLAudioElement) {
      element.pause();
      if (
        recycledElements.length === 0 ||
        recycledElements.every((e) => e.parentElement !== null)
      ) {
        recycledElements.push(element);
      }
    }
  }

  stop(): void {
    this.stopMonitor();
    this.mediaStreamTrack?.stop();
    this.detach();
  }
}

export interface TrackDimensions {
  width: number;
  height: number;
}
