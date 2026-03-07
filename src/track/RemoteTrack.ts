import { Track, type TrackEvents } from './Track';
import { TrackKind, TrackSource } from '../protocol/types';
import { TrackEvent } from '../events';

export interface RemoteTrackEvents extends TrackEvents {
  [TrackEvent.Subscribed]: (track: RemoteTrack) => void;
  [TrackEvent.Unsubscribed]: (track: RemoteTrack) => void;
}

export class RemoteTrack extends Track {
  subscriptionSid?: string;
  publisherSid?: string;

  constructor(
    kind: TrackKind,
    name: string,
    source: TrackSource = TrackSource.Unknown,
    mediaStreamTrack: MediaStreamTrack,
  ) {
    super(kind, name, source, mediaStreamTrack);
  }

  setMediaStreamTrack(track: MediaStreamTrack): void {
    this.mediaStreamTrack = track;
    for (const el of this.attachedElements) {
      const stream = new MediaStream([track]);
      el.srcObject = stream;
    }
  }
}
