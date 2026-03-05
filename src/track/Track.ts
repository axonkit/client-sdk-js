import { TypedEventEmitter } from '../utils/events';
import { TrackKind, TrackSource } from '../protocol/types';

export interface TrackEvents {
  muted: (track: Track) => void;
  unmuted: (track: Track) => void;
  ended: (track: Track) => void;
  elementAttached: (element: HTMLMediaElement) => void;
  elementDetached: (element: HTMLMediaElement) => void;
}

export abstract class Track extends TypedEventEmitter<TrackEvents> {
  kind: TrackKind;
  name: string;
  source: TrackSource;
  sid?: string;
  mediaStreamTrack?: MediaStreamTrack;
  isMuted = false;

  protected attachedElements: Set<HTMLMediaElement> = new Set();

  constructor(
    kind: TrackKind,
    name: string,
    source: TrackSource = TrackSource.Unknown,
    mediaStreamTrack?: MediaStreamTrack,
  ) {
    super();
    this.kind = kind;
    this.name = name;
    this.source = source;
    this.mediaStreamTrack = mediaStreamTrack;
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

    if (this.mediaStreamTrack) {
      const stream = new MediaStream([this.mediaStreamTrack]);
      element.srcObject = stream;
    }

    this.attachedElements.add(element);
    this.emit('elementAttached', element);
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
    this.emit('elementDetached', element);
  }

  stop(): void {
    this.mediaStreamTrack?.stop();
    this.detach();
  }
}
