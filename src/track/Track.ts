import { TypedEventEmitter } from '../utils/events';
import { TrackKind, TrackSource } from '../protocol/types';
import { TrackEvent } from '../events';

export interface TrackEvents {
  [TrackEvent.Muted]: (track: Track) => void;
  [TrackEvent.Unmuted]: (track: Track) => void;
  [TrackEvent.Ended]: (track: Track) => void;
  [TrackEvent.ElementAttached]: (element: HTMLMediaElement) => void;
  [TrackEvent.ElementDetached]: (element: HTMLMediaElement) => void;
}

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
      element = document.createElement(
        this.kind === TrackKind.Audio ? 'audio' : 'video',
      );
      element.autoplay = true;
      if (this.kind === TrackKind.Video) {
        (element as HTMLVideoElement).playsInline = true;
      }
    }

    const stream = new MediaStream([this.mediaStreamTrack]);
    element.srcObject = stream;

    this.attachedElements.add(element);
    this.emit(TrackEvent.ElementAttached, element);
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
    this.emit(TrackEvent.ElementDetached, element);
  }

  stop(): void {
    this.mediaStreamTrack?.stop();
    this.detach();
  }
}
