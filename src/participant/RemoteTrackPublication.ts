import { types as mediasoupTypes } from 'mediasoup-client';
import { TrackPublication, SubscriptionStatus, PermissionStatus } from './Participant';
import type { RemoteTrack } from '../track/RemoteTrack';
import type { RPCClient } from '../signal/RPCClient';
import type { TrackSource, TrackInfo } from '../protocol/types';
import { TrackKind, VideoQuality } from '../protocol/types';
import { getLogger } from '../utils/logger';

const log = getLogger('RemoteTrackPublication');

export class RemoteTrackPublication extends TrackPublication {
  /** @internal */
  consumer?: mediasoupTypes.Consumer;
  /** @internal */
  rpc?: RPCClient;

  /** @internal */
  protected allowed = true;

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
  }) {
    super(init);
    this.consumer = init.consumer;
    this.rpc = init.rpc;
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

  /** Whether the server has allowed this track subscription. */
  get permissionStatus(): PermissionStatus {
    return this.allowed
      ? PermissionStatus.Allowed
      : PermissionStatus.NotAllowed;
  }

  /** The currently requested video quality. */
  get videoQuality(): VideoQuality | undefined {
    return this._videoQuality ?? VideoQuality.HIGH;
  }

  /** Whether the server is enabled to send data for this track. */
  override get isEnabled(): boolean {
    return this._enabled;
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
   * Enable or disable the server from sending data for this track.
   * Useful when a track is off-screen.
   */
  setEnabled(enabled: boolean): void {
    if (this._enabled === enabled) return;
    this._enabled = enabled;
    if (!this.consumer || !this.rpc) return;

    if (enabled) {
      this.consumer.resume();
      this.rpc.request('subscription.resume', {
        subscriptionSid: this.consumer.id,
      }).catch(() => {});
    } else {
      this.consumer.pause();
      this.rpc.request('subscription.pause', {
        subscriptionSid: this.consumer.id,
      }).catch(() => {});
    }
  }

  /**
   * Control whether the subscription for this track is desired.
   * When set to `false`, the server will stop sending media for this track.
   */
  setSubscribed(subscribed: boolean): void {
    if (this._subscribed === subscribed) return;
    this._subscribed = subscribed;
    if (subscribed) {
      this.allowed = true;
    }
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

  /** @internal */
  setAllowed(allowed: boolean): void {
    this.allowed = allowed;
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
   * Takes precedence over adaptive stream dimensions.
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
    if (!this.rpc || !this.consumer) return;

    let spatialLayer: number | undefined;
    let temporalLayer: number | undefined;
    let width: number | undefined;
    let height: number | undefined;

    if (this._requestedVideoDimensions) {
      width = this._requestedVideoDimensions.width;
      height = this._requestedVideoDimensions.height;
    } else if (this._videoQuality !== undefined) {
      spatialLayer = this._videoQuality === VideoQuality.LOW ? 0
        : this._videoQuality === VideoQuality.MEDIUM ? 1 : 2;
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

    this.rpc.request('subscription.setPreferredLayers', {
      subscriptionSid: this.consumer.id,
      spatialLayer: spatialLayer ?? 2,
      temporalLayer,
      width,
      height,
    }).catch((e) => {
      log.warn('Failed to set preferred layers', e);
    });
  }
}
