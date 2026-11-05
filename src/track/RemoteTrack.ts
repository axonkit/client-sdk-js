import { Track } from './Track';
import { TrackKind, TrackSource } from '../protocol/types';
import { TrackEvent } from '../events';
import { types as mediasoupTypes } from 'mediasoup-client';
import { getLogger } from '../utils/logger';

const log = getLogger('RemoteTrack');
const MONITOR_FREQUENCY = 2000;

export class RemoteTrack extends Track {
  /** @internal */
  subscriptionSid?: string;
  /** @internal */
  publisherSid?: string;

  /** @internal */
  consumer?: mediasoupTypes.Consumer;

  private _rtpTimestamp?: number;
  private _timeSyncHandle?: number;

  constructor(
    kind: TrackKind,
    source: TrackSource = TrackSource.Unknown,
    mediaStreamTrack: MediaStreamTrack,
  ) {
    super(kind, source, mediaStreamTrack);
  }

  get isLocal(): boolean {
    return false;
  }

  /** @internal */
  setMuted(muted: boolean): void {
    if (this._isMuted === muted) return;
    this._isMuted = muted;
    if (this.consumer) {
      if (muted) {
        this.consumer.pause();
      } else {
        this.consumer.resume();
      }
    } else {
      this.mediaStreamTrack.enabled = !muted;
    }
    this.emit(muted ? TrackEvent.Muted : TrackEvent.Unmuted, this);
  }

  /**
   * Stop the remote track.
   */
  override stop(): void {
    this.stopMonitor();
    this.detach();
    if (this.consumer) {
      this.consumer.close();
    } else {
      this._mediaStreamTrack.enabled = false;
    }
  }

  /** @internal */
  override stopMonitor(): void {
    super.stopMonitor();
    if (this._timeSyncHandle !== undefined) {
      cancelAnimationFrame(this._timeSyncHandle);
      this._timeSyncHandle = undefined;
    }
  }

  /**
   * Gets the RTCStatsReport for the underlying RTP receiver.
   */
  async getRTCStatsReport(): Promise<RTCStatsReport | undefined> {
    if (!this.consumer) return undefined;
    return this.consumer.getStats();
  }

  /**
   * Set a playout delay (in seconds) for this track. Higher values allow
   * more buffering in the browser and add latency.
   */
  setPlayoutDelay(delayInSeconds: number): void {
    const receiver = this.consumer?.rtpReceiver;
    if (receiver && 'playoutDelayHint' in receiver) {
      (receiver as any).playoutDelayHint = delayInSeconds;
    } else {
      log.warn('Playout delay not supported in this browser');
    }
  }

  /** Returns the current playout delay (in seconds). */
  getPlayoutDelay(): number {
    const receiver = this.consumer?.rtpReceiver;
    if (receiver && 'playoutDelayHint' in receiver) {
      return (receiver as any).playoutDelayHint as number;
    }
    return 0;
  }

  /** @internal */
  override startMonitor(): void {
    if (this.monitorInterval) return;
    this._prevBytes = 0;
    this._prevStatsTime = 0;
    this.monitorInterval = setInterval(() => {
      if (!this.consumer) return;
      this.monitorStats(() => this.consumer!.getStats(), 'inbound-rtp', 'bytesReceived');
    }, MONITOR_FREQUENCY);
    if (this.supportsSynchronizationSources()) {
      this.registerTimeSyncUpdate();
    }
  }

  /**
   * Registers a loop that emits {@link TrackEvent.TimeSyncUpdate} events
   * with the current RTP timestamp and browser timestamp, useful for
   * lip-sync and cross-track synchronization.
   */
  private registerTimeSyncUpdate(): void {
    const receiver = this.consumer?.rtpReceiver;
    if (!receiver) return;
    const loop = () => {
      this._timeSyncHandle = requestAnimationFrame(() => loop());
      const sources = receiver.getSynchronizationSources?.()?.[0];
      if (sources) {
        const { timestamp, rtpTimestamp } = sources;
        if (rtpTimestamp && this._rtpTimestamp !== rtpTimestamp) {
          this.emit(TrackEvent.TimeSyncUpdate, { timestamp, rtpTimestamp });
          this._rtpTimestamp = rtpTimestamp;
        }
      }
    };
    loop();
  }

  private supportsSynchronizationSources(): boolean {
    return (
      typeof RTCRtpReceiver !== 'undefined' &&
      'getSynchronizationSources' in RTCRtpReceiver.prototype
    );
  }
}
