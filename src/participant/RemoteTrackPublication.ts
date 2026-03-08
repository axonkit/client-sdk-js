import { types as mediasoupTypes } from 'mediasoup-client';
import { TrackPublication } from './Participant';
import type { RemoteTrack } from '../track/RemoteTrack';
import type { RPCClient } from '../signal/RPCClient';
import type { TrackSource, TrackInfo } from '../protocol/types';
import { VideoQuality } from '../protocol/types';
import { getLogger } from '../utils/logger';

const log = getLogger('RemoteTrackPublication');

export class RemoteTrackPublication extends TrackPublication {
  /** @internal */
  consumer?: mediasoupTypes.Consumer;
  /** @internal */
  rpc?: RPCClient;

  private _subscribed = true;
  private _videoQuality?: VideoQuality;

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

  /**
   * Control whether the subscription for this track is desired.
   * When set to `false`, the server will stop sending media for this track.
   */
  setSubscribed(subscribed: boolean): void {
    if (this._subscribed === subscribed) return;
    this._subscribed = subscribed;
    if (!this.rpc) return;

    if (subscribed) {
      this.rpc.request('subscription.subscribe', {
        trackSid: this.trackSid,
      }).catch((e) => {
        log.warn('Failed to subscribe', e);
      });
    } else {
      this.rpc.request('subscription.unsubscribe', {
        trackSid: this.trackSid,
      }).catch((e) => {
        log.warn('Failed to unsubscribe', e);
      });
    }
  }

  /**
   * Set the preferred video quality for this subscription.
   * Only applicable to video tracks.
   */
  setVideoQuality(quality: VideoQuality): void {
    this._videoQuality = quality;
    if (!this.rpc || !this.consumer) return;

    const spatialLayer = quality === VideoQuality.LOW ? 0 : quality === VideoQuality.MEDIUM ? 1 : 2;
    this.rpc.request('subscription.setPreferredLayers', {
      subscriptionSid: this.consumer.id,
      spatialLayer,
    }).catch((e) => {
      log.warn('Failed to set video quality', e);
    });
  }

}
