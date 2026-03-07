import { types as mediasoupTypes } from 'mediasoup-client';
import { TrackPublication } from './Participant';
import type { RemoteTrack } from '../track/RemoteTrack';
import type { TrackSource, TrackInfo } from '../protocol/types';

export class RemoteTrackPublication extends TrackPublication {
  consumer?: mediasoupTypes.Consumer;

  constructor(init: {
    trackSid: string;
    trackName: string;
    kind: string;
    source: TrackSource;
    track?: RemoteTrack;
    muted: boolean;
    info?: TrackInfo;
    consumer?: mediasoupTypes.Consumer;
  }) {
    super(init);
    this.consumer = init.consumer;
  }

  get remoteTrack(): RemoteTrack | undefined {
    return this.track as RemoteTrack | undefined;
  }

  get subscribed(): boolean {
    return this.track !== undefined;
  }
}
