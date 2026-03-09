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

  private _prevBytesReceived = 0;
  private _prevStatsTime = 0;
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
    if (this.isMuted === muted) return;
    if (!this.consumer) return;
    if (muted) {
      this.consumer.pause();
    } else {
      this.consumer.resume();
    }
    this.emit(muted ? TrackEvent.Muted : TrackEvent.Unmuted, this);
  }

  setMediaStreamTrack(track: MediaStreamTrack): void {
    this.mediaStreamTrack = track;
    for (const el of this.attachedElements) {
      const stream = new MediaStream([track]);
      el.srcObject = stream;
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
   * Gets the RTCStatsReport for the underlying mediasoup Consumer.
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
    this._prevBytesReceived = 0;
    this._prevStatsTime = 0;
    this.monitorInterval = setInterval(() => this.monitorReceiver(), MONITOR_FREQUENCY);
    if (this.supportsSynchronizationSources()) {
      this.registerTimeSyncUpdate();
    }
  }

  /**
   * Registers a loop that emits {@link TrackEvent.TimeSyncUpdate} events
   * with the current RTP timestamp and browser timestamp, useful for
   * lip-sync and cross-track synchronization.
   */
  registerTimeSyncUpdate(): void {
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

  private async monitorReceiver(): Promise<void> {
    if (!this.consumer) return;
    try {
      const stats = await this.consumer.getStats();
      let bytesReceived = 0;
      stats.forEach((report) => {
        if (report.type === 'inbound-rtp') {
          bytesReceived += (report as any).bytesReceived ?? 0;
        }
      });
      const now = Date.now();
      if (this._prevStatsTime > 0 && bytesReceived > this._prevBytesReceived) {
        const elapsed = (now - this._prevStatsTime) / 1000;
        this._currentBitrate = ((bytesReceived - this._prevBytesReceived) * 8) / elapsed;
      }
      this._prevBytesReceived = bytesReceived;
      this._prevStatsTime = now;
    } catch {
      // stats collection may fail after consumer is closed
    }
  }
}
