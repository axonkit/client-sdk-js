import { types as mediasoupTypes } from 'mediasoup-client';
import { TrackPublication, SubscriptionStatus } from './Participant';
import type { RemoteTrack } from '../track/RemoteTrack';
import type { RPCClient } from '../signal/RPCClient';
import type { TrackSource, TrackInfo } from '../protocol/types';
import { TrackKind, VideoQuality, StreamState } from '../protocol/types';
import { getLogger } from '../utils/logger';

const log = getLogger('RemoteTrackPublication');

export class RemoteTrackPublication extends TrackPublication {
  streamState: StreamState = StreamState.Active;

  private _consumer?: mediasoupTypes.Consumer;
  private _rpc?: RPCClient;
  private _subscribed = true;
  private _videoQuality?: VideoQuality;
  private _enabled = true;
  private _fps?: number;
  private _requestedVideoDimensions?: { width: number; height: number };

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
    subscribed?: boolean;
  }) {
    super(init);
    this._consumer = init.consumer;
    this._rpc = init.rpc;
    this._subscribed = init.subscribed ?? true;
  }

  /**
   * @internal — wire mediasoup consumer + RPC after server pushes a subscription
   * (existing publication from snapshot, or same path as constructor for new pubs).
   */
  attachSubscription(track: RemoteTrack, consumer: mediasoupTypes.Consumer, rpc: RPCClient): void {
    this.track = track;
    this._consumer = consumer;
    this._rpc = rpc;
    this._subscribed = true;
  }

  /** Whether this track is currently subscribed. */
  override get isSubscribed(): boolean {
    if (!this._subscribed) return false;
    return super.isSubscribed;
  }

  /** Returns `true` if the client wants to subscribe to this track. */
  get isDesired(): boolean {
    return this._subscribed;
  }

  /** Current subscription status. */
  get subscriptionStatus(): SubscriptionStatus {
    if (!this._subscribed) return SubscriptionStatus.Unsubscribed;
    if (!super.isSubscribed) return SubscriptionStatus.Desired;
    return SubscriptionStatus.Subscribed;
  }

  /** The currently requested video quality. */
  get videoQuality(): VideoQuality | undefined {
    return this._videoQuality ?? VideoQuality.HIGH;
  }

  /** Whether the server is enabled to send data for this track. */
  override get isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * Enable or disable the server from sending data for this track.
   * Useful when a track is off-screen.
   */
  setEnabled(enabled: boolean): void {
    if (this._enabled === enabled) return;
    this._enabled = enabled;
    if (!this._consumer || !this._rpc) return;

    if (enabled) {
      this._consumer.resume();
      this._rpc
        .request('subscription.resume', {
          subscriptionSid: this._consumer.id,
        })
        .catch(() => {});
    } else {
      this._consumer.pause();
      this._rpc
        .request('subscription.pause', {
          subscriptionSid: this._consumer.id,
        })
        .catch(() => {});
    }
  }

  /**
   * Control whether the subscription for this track is desired.
   * When set to `false`, the server will stop sending media for this track.
   */
  setSubscribed(subscribed: boolean): void {
    if (this._subscribed === subscribed) return;
    this._subscribed = subscribed;
    if (!this._rpc) return;

    if (subscribed) {
      this._rpc
        .request('subscription.subscribe', {
          trackSid: this.trackSid,
        })
        .catch((e) => {
          log.warn('Failed to subscribe', e);
        });
    } else {
      this._rpc
        .request('subscription.unsubscribe', {
          trackSid: this.trackSid,
        })
        .catch((e) => {
          log.warn('Failed to unsubscribe', e);
        });
    }
  }

  /**
   * Set the preferred video quality for this subscription.
   * Only applicable to video tracks.
   */
  setVideoQuality(quality: VideoQuality): void {
    if (!this.isManualOperationAllowed() || this._videoQuality === quality) return;
    this._videoQuality = quality;
    this._requestedVideoDimensions = undefined;
    this.emitTrackUpdate();
  }

  /**
   * Explicitly set the desired video dimensions for this track.
   * Maps to spatialLayer using {@link TrackInfo} width/height as the high layer
   * and typical simulcast factors (1/2, 1/4) when layer metadata is not on the wire.
   */
  setVideoDimensions(dimensions: { width: number; height: number }): void {
    if (!this.isManualOperationAllowed()) return;
    if (
      this._requestedVideoDimensions?.width === dimensions.width &&
      this._requestedVideoDimensions?.height === dimensions.height
    ) {
      return;
    }
    this._requestedVideoDimensions = dimensions;
    this._videoQuality = undefined;
    this.emitTrackUpdate();
  }

  /**
   * Set the desired video FPS for this subscription.
   * In simulcast and SVC scenarios, fps controls the temporal layer.
   */
  setVideoFPS(fps: number): void {
    if (!this.isManualOperationAllowed()) return;
    if (this.kind !== TrackKind.Video) return;
    if (this._fps === fps) return;
    this._fps = fps;
    this.emitTrackUpdate();
  }

  private isManualOperationAllowed(): boolean {
    if (!this.isDesired) {
      log.warn('Cannot update track settings when not subscribed');
      return false;
    }
    return true;
  }

  /**
   * Sends the current preferred layers to the server.
   * Computes spatialLayer from videoQuality or dimensions, and temporalLayer from fps.
   */
  private emitTrackUpdate(): void {
    if (!this._rpc || !this._consumer) return;

    let spatialLayer: number;
    let temporalLayer: number | undefined;

    if (this._requestedVideoDimensions) {
      spatialLayer = this.spatialLayerForDimensions(this._requestedVideoDimensions);
    } else if (this._videoQuality !== undefined) {
      spatialLayer =
        this._videoQuality === VideoQuality.LOW
          ? 0
          : this._videoQuality === VideoQuality.MEDIUM
            ? 1
            : 2;
    } else {
      spatialLayer = 2;
    }

    if (this._fps !== undefined) {
      if (this._fps <= 10) {
        temporalLayer = 0;
      } else if (this._fps <= 20) {
        temporalLayer = 1;
      } else {
        temporalLayer = 2;
      }
    }

    this._rpc
      .request('subscription.setPreferredLayers', {
        subscriptionSid: this._consumer.id,
        spatialLayer,
        temporalLayer,
      })
      .catch((e) => {
        log.warn('Failed to set preferred layers', e);
      });
  }

  /**
   * Pick the smallest spatial layer whose notional size covers the request.
   * Uses published track dimensions as the full layer; derives low/medium like
   * LiveKit's videoLayersFromEncodings (ceil half / quarter) when only width/height exist.
   */
  private spatialLayerForDimensions(requested: { width: number; height: number }): number {
    const w = this.info?.width;
    const h = this.info?.height;
    if (!w || !h) {
      return 2;
    }
    const layers = [
      { q: 0, width: Math.ceil(w / 4), height: Math.ceil(h / 4) },
      { q: 1, width: Math.ceil(w / 2), height: Math.ceil(h / 2) },
      { q: 2, width: w, height: h },
    ];
    for (const layer of layers) {
      if (layer.width >= requested.width && layer.height >= requested.height) {
        return layer.q;
      }
    }
    return 2;
  }
}
