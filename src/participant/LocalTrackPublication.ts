import { types as mediasoupTypes } from 'mediasoup-client';
import { TrackPublication } from './Participant';
import type { LocalTrack } from '../track/LocalTrack';
import type { TrackSource, TrackInfo } from '../protocol/types';

export class LocalTrackPublication extends TrackPublication {
  producer?: mediasoupTypes.Producer;

  constructor(init: {
    trackSid: string;
    trackName: string;
    kind: string;
    source: TrackSource;
    track?: LocalTrack;
    muted: boolean;
    info?: TrackInfo;
    producer?: mediasoupTypes.Producer;
  }) {
    super(init);
    this.producer = init.producer;
  }

  get localTrack(): LocalTrack | undefined {
    return this.track as LocalTrack | undefined;
  }

  async mute(): Promise<void> {
    if (this.localTrack) {
      await this.localTrack.mute();
    }
  }

  async unmute(): Promise<void> {
    if (this.localTrack) {
      await this.localTrack.unmute();
    }
  }
}
