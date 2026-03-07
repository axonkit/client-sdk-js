import { types as mediasoupTypes } from 'mediasoup-client';
import { TrackPublication } from './Participant';
import type { RemoteTrack } from '../track/RemoteTrack';
import type { RPCClient } from '../signal/RPCClient';
import type { TrackSource, TrackInfo } from '../protocol/types';

export class RemoteTrackPublication extends TrackPublication {
  /** @internal */
  consumer?: mediasoupTypes.Consumer;
  /** @internal */
  rpc?: RPCClient;

  /** @internal */
  constructor(init: {
    trackSid: string;
    trackName: string;
    kind: string;
    source: TrackSource;
    track?: RemoteTrack;
    muted: boolean;
    info?: TrackInfo;
    consumer?: mediasoupTypes.Consumer;
    rpc?: RPCClient;
  }) {
    super(init);
    this.consumer = init.consumer;
    this.rpc = init.rpc;
  }

  get remoteTrack(): RemoteTrack | undefined {
    return this.track as RemoteTrack | undefined;
  }

  override mute(): void {
    if (!this.consumer) return;
    this.consumer.pause();
    this.track?.setMuted(true);
    this.rpc?.request('subscription.pause', {
      subscriptionSid: this.consumer.id,
    }).catch(() => {});
  }

  override unmute(): void {
    if (!this.consumer) return;
    this.consumer.resume();
    this.track?.setMuted(false);
    this.rpc?.request('subscription.resume', {
      subscriptionSid: this.consumer.id,
    }).catch(() => {});
  }
}
