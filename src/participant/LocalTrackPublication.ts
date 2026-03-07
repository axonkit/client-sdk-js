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

  override mute(): void {
    this.producer?.pause();
    this.localTrack?.setMuted(true);
    this.rpc?.request('track.mute', { trackSid: this.trackSid, muted: true }).catch(() => {});
  }

  override unmute(): void {
    this.producer?.resume();
    this.localTrack?.setMuted(false);
    this.rpc?.request('track.mute', { trackSid: this.trackSid, muted: false }).catch(() => {});
  }
}
