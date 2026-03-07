import { types as mediasoupTypes } from 'mediasoup-client';
import { TrackPublication } from './Participant';
import type { LocalTrack } from '../track/LocalTrack';
import type { RPCClient } from '../signal/RPCClient';
import type { TrackSource, TrackInfo } from '../protocol/types';

export class LocalTrackPublication extends TrackPublication {
  producer?: mediasoupTypes.Producer;
  private rpc?: RPCClient;

  constructor(init: {
    trackSid: string;
    trackName: string;
    kind: string;
    source: TrackSource;
    track?: LocalTrack;
    muted: boolean;
    info?: TrackInfo;
    producer?: mediasoupTypes.Producer;
    rpc?: RPCClient;
  }) {
    super(init);
    this.producer = init.producer;
    this.rpc = init.rpc;
  }

  get localTrack(): LocalTrack | undefined {
    return this.track as LocalTrack | undefined;
  }

  async mute(): Promise<void> {
    if (this.localTrack) {
      await this.localTrack.mute();
    }
    this.muted = true;
    this.rpc?.request('track.mute', { trackSid: this.trackSid, muted: true }).catch(() => {});
  }

  async unmute(): Promise<void> {
    if (this.localTrack) {
      await this.localTrack.unmute();
    }
    this.muted = false;
    this.rpc?.request('track.mute', { trackSid: this.trackSid, muted: false }).catch(() => {});
  }
}
