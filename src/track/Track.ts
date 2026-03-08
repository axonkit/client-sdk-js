import { TypedEventEmitter } from '../utils/events';
import { TrackKind, TrackSource } from '../protocol/types';
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
  [TrackEvent.VideoDimensionsChanged]: (dimensions: Track.Dimensions, track: Track) => void;
  [TrackEvent.AudioSilenceDetected]: () => void;
}

// Keep old audio elements for re-use. On iOS Safari, tracks which audio
// elements have been "blessed" by the user are remembered by the browser.
const recycledElements: HTMLAudioElement[] = [];

export abstract class Track extends TypedEventEmitter<TrackEvents> {
  kind: TrackKind;
  name: string;
  source: TrackSource;
  sid?: string;
  mediaStreamTrack: MediaStreamTrack;
  isMuted = false;

  protected attachedElements: Set<HTMLMediaElement> = new Set();

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
    this.isMuted = !mediaStreamTrack.enabled;
  }

  setMuted(value: boolean): void {
    if (this.isMuted === value) return;
    this.isMuted = value;
    this.mediaStreamTrack.enabled = !value;
    this.emit(value ? TrackEvent.Muted : TrackEvent.Unmuted, this);
  }

  attach(element?: HTMLMediaElement): HTMLMediaElement {
    if (!element) {
      if (this.kind === TrackKind.Audio) {
        // Try to reuse a recycled audio element (iOS Safari workaround)
        const recycled = recycledElements.find((e) => e.parentElement === null);
        if (recycled) {
          recycledElements.splice(recycledElements.indexOf(recycled), 1);
          element = recycled;
        }
      }
      if (!element) {
        element = document.createElement(
          this.kind === TrackKind.Audio ? 'audio' : 'video',
        );
      }
      element.autoplay = true;
      if (this.kind === TrackKind.Video) {
        (element as HTMLVideoElement).playsInline = true;
      }
    }

    const stream = new MediaStream([this.mediaStreamTrack]);
    // Avoid setting muted attribute for elements with audio
    element.muted = stream.getAudioTracks().length === 0;
    element.srcObject = stream;

    this.attachedElements.add(element);
    this.emit(TrackEvent.ElementAttached, element);

    const hasAudio = stream.getAudioTracks().length > 0;
    element.play()
      .then(() => {
        this.emit(hasAudio ? TrackEvent.AudioPlaybackStarted : TrackEvent.VideoPlaybackStarted);
      })
      .catch((e: Error) => {
        if (e.name === 'NotAllowedError') {
          this.emit(hasAudio ? TrackEvent.AudioPlaybackFailed : TrackEvent.VideoPlaybackFailed, e);
        }
        // If audio playback blocked, try muted video playback
        if (hasAudio && element && stream.getVideoTracks().length > 0 && e.name === 'NotAllowedError') {
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
    const elements = Array.from(this.attachedElements);
    for (const el of elements) {
      this.detachElement(el);
    }
    return elements;
  }

  private detachElement(element: HTMLMediaElement): void {
    element.srcObject = null;
    this.attachedElements.delete(element);
    this.recycleElement(element);
    this.emit(TrackEvent.ElementDetached, element);
  }

  private recycleElement(element: HTMLMediaElement): void {
    if (element instanceof HTMLAudioElement) {
      element.pause();
      // Only keep one recycled element
      if (recycledElements.length === 0 || recycledElements.every((e) => e.parentElement !== null)) {
        recycledElements.push(element);
      }
    }
  }

  stop(): void {
    this.mediaStreamTrack?.stop();
    this.detach();
  }
}

export namespace Track {
  export interface Dimensions {
    width: number;
    height: number;
  }
}
