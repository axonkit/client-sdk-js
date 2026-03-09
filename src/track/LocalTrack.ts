import { Track, type TrackDimensions, type TrackEvents } from './Track';
import { TrackKind, TrackSource } from '../protocol/types';
import { TrackEvent } from '../events';
import { getLogger } from '../utils/logger';
import { types as mediasoupTypes } from 'mediasoup-client';
import type { TrackProcessor, ProcessorOptions } from './processor/types';

const log = getLogger('LocalTrack');

const MONITOR_FREQUENCY = 2000;
const DEFAULT_DIMENSIONS_TIMEOUT = 1000;

export interface LocalTrackEvents extends TrackEvents {
  [TrackEvent.Restarted]: (track: LocalTrack) => void;
}

export class LocalTrack extends Track {
  private _constraints?: MediaTrackConstraints;
  private _producer?: mediasoupTypes.Producer;
  private _processor?: TrackProcessor;
  private _isUpstreamPaused = false;
  private _providedByUser = false;
  private _prevBytesSent = 0;
  private _prevStatsTime = 0;

  constructor(
    kind: TrackKind,
    mediaStreamTrack: MediaStreamTrack,
    source?: TrackSource,
    constraints?: MediaTrackConstraints,
    userProvided = false,
  ) {
    super(kind, source ?? TrackSource.Unknown, mediaStreamTrack);
    this._constraints = constraints;
    this._providedByUser = userProvided;
  }

  get isLocal(): boolean {
    return true;
  }

  /** The MediaStreamTrack id. */
  get id(): string {
    return this.mediaStreamTrack.id;
  }

  /** Current capture constraints. */
  get constraints(): MediaTrackConstraints | undefined {
    return this._constraints;
  }

  /**
   * Video dimensions from the current track settings.
   * Returns `undefined` for audio tracks.
   */
  get dimensions(): TrackDimensions | undefined {
    if (this.kind !== TrackKind.Video) return undefined;
    const { width, height } = this.mediaStreamTrack.getSettings();
    if (width && height) return { width, height };
    return undefined;
  }

  /** Whether upstream publishing has been paused via {@link pauseUpstream}. */
  get isUpstreamPaused(): boolean {
    return this._isUpstreamPaused;
  }

  /** Whether the track was provided by the user (not managed by the SDK). */
  get isUserProvided(): boolean {
    return this._providedByUser;
  }

  /** @internal */
  get producer(): mediasoupTypes.Producer | undefined {
    return this._producer;
  }

  /** @internal */
  set producer(p: mediasoupTypes.Producer | undefined) {
    this._producer = p;
  }

  /** Returns the currently active processor, or `undefined`. */
  getProcessor(): TrackProcessor | undefined {
    return this._processor;
  }

  /**
   * Set a {@link TrackProcessor} on this track. Pass `undefined` to remove
   * the current processor.
   */
  async setProcessor(
    processor: TrackProcessor | undefined,
    showProcessedStreamLocally = true,
  ): Promise<void> {
    if (this._processor) {
      await this._processor.destroy();
      this._processor = undefined;
    }

    if (!processor) {
      if (this._producer) {
        await this._producer.replaceTrack({ track: this.mediaStreamTrack });
      }
      return;
    }

    const opts: ProcessorOptions = {
      kind: this.kind,
      track: this.mediaStreamTrack,
    };
    await processor.init(opts);

    this._processor = processor;

    if (processor.processedTrack) {
      if (showProcessedStreamLocally) {
        for (const el of this.attachedElements) {
          const stream = new MediaStream([processor.processedTrack]);
          el.srcObject = stream;
        }
      }
      if (this._producer) {
        await this._producer.replaceTrack({ track: processor.processedTrack });
      }
    }
  }

  /** Stop and remove the current processor. */
  async stopProcessor(): Promise<void> {
    if (!this._processor) return;

    this._processor.processedTrack?.stop();
    await this._processor.destroy();
    this._processor = undefined;

    if (this._producer) {
      await this._producer.replaceTrack({ track: this.mediaStreamTrack });
    }
    for (const el of this.attachedElements) {
      const stream = new MediaStream([this.mediaStreamTrack]);
      el.srcObject = stream;
    }
  }

  /** Mute the track (disables the MediaStreamTrack). */
  async mute(): Promise<LocalTrack> {
    this.setTrackMuted(true);
    return this;
  }

  /** Unmute the track (enables the MediaStreamTrack). */
  async unmute(): Promise<LocalTrack> {
    this.setTrackMuted(false);
    return this;
  }

  /**
   * Pause publishing to the server without disabling the local
   * MediaStreamTrack. Useful for showing a local preview while
   * not sending to remote participants.
   */
  async pauseUpstream(): Promise<void> {
    if (this._isUpstreamPaused) return;
    if (!this._producer) {
      log.warn('Cannot pause upstream for an unpublished track');
      return;
    }
    this._isUpstreamPaused = true;
    await this._producer.replaceTrack({ track: null as any });
    this.emit(TrackEvent.UpstreamPaused, this);
  }

  /** Resume publishing after a call to {@link pauseUpstream}. */
  async resumeUpstream(): Promise<void> {
    if (!this._isUpstreamPaused) return;
    if (!this._producer) {
      log.warn('Cannot resume upstream for an unpublished track');
      return;
    }
    this._isUpstreamPaused = false;
    const trackToSend = this._processor?.processedTrack ?? this.mediaStreamTrack;
    await this._producer.replaceTrack({ track: trackToSend });
    this.emit(TrackEvent.UpstreamResumed, this);
  }

  /**
   * Gets the RTCStatsReport for the underlying mediasoup Producer.
   */
  async getRTCStatsReport(): Promise<RTCStatsReport | undefined> {
    if (!this._producer) return undefined;
    return this._producer.getStats();
  }

  /**
   * Pauses or resumes the producer based on whether there are active
   * subscribers (dynacast). Works for both audio and video tracks.
   */
  async setSubscriptionStatus(hasSubscribers: boolean): Promise<void> {
    if (!this._producer) return;
    if (hasSubscribers) {
      this._producer.resume();
    } else {
      this._producer.pause();
    }
  }

  /**
   * Get the device ID currently used by this track.
   */
  async getDeviceId(): Promise<string | undefined> {
    if (this.source === TrackSource.ScreenShare) return undefined;
    return this.mediaStreamTrack.getSettings().deviceId;
  }

  /**
   * Wait until the video track reports valid dimensions.
   * @throws Error if the track is audio or dimensions don't become
   *         available within the timeout.
   */
  async waitForDimensions(timeout = DEFAULT_DIMENSIONS_TIMEOUT): Promise<TrackDimensions> {
    if (this.kind === TrackKind.Audio) {
      throw new Error('Cannot get dimensions for audio tracks');
    }
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const dims = this.dimensions;
      if (dims) return dims;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Unable to get track dimensions after timeout');
  }

  /** @internal */
  override startMonitor(): void {
    if (this.monitorInterval) return;
    this._prevBytesSent = 0;
    this._prevStatsTime = 0;
    this.monitorInterval = setInterval(() => this.monitorSender(), MONITOR_FREQUENCY);
  }

  async restart(constraints?: MediaTrackConstraints): Promise<void> {
    if (constraints) {
      this._constraints = constraints;
    }

    const kind = this.kind === TrackKind.Audio ? 'audio' : 'video';
    const stream = await navigator.mediaDevices.getUserMedia({
      [kind]: this._constraints ?? true,
    });

    const newTrack = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];

    if (!newTrack) throw new Error('Failed to get new media track');

    await this.replaceTrack(newTrack);
    log.info(`Track ${this.sid ?? 'unknown'} restarted`);
    (this as any).emit(TrackEvent.Restarted, this);
  }

  async replaceTrack(newTrack: MediaStreamTrack): Promise<void> {
    const oldTrack = this.mediaStreamTrack;
    this.mediaStreamTrack = newTrack;

    let trackForProducer = newTrack;
    if (this._processor) {
      await this._processor.restart({ kind: this.kind, track: newTrack });
      if (this._processor.processedTrack) {
        trackForProducer = this._processor.processedTrack;
      }
    }

    if (this._producer) {
      await this._producer.replaceTrack({ track: trackForProducer });
    }

    for (const el of this.attachedElements) {
      const stream = new MediaStream([newTrack]);
      el.srcObject = stream;
    }

    if (!this._providedByUser) {
      oldTrack?.stop();
    }
  }

  stop(): void {
    if (this._processor) {
      this._processor.destroy().catch(() => {});
      this._processor = undefined;
    }
    super.stop();
    log.debug(`Track ${this.sid ?? 'unknown'} stopped`);
  }

  protected setTrackMuted(muted: boolean): void {
    if (this.isMuted === muted) return;
    if (this._producer) {
      if (muted) {
        this._producer.pause();
      } else {
        this._producer.resume();
      }
    } else {
      this.mediaStreamTrack.enabled = !muted;
    }
    this.emit(muted ? TrackEvent.Muted : TrackEvent.Unmuted, this);
  }

  private async monitorSender(): Promise<void> {
    if (!this._producer) return;
    try {
      const stats = await this._producer.getStats();
      let bytesSent = 0;
      stats.forEach((report) => {
        if (report.type === 'outbound-rtp') {
          bytesSent += (report as any).bytesSent ?? 0;
        }
      });
      const now = Date.now();
      if (this._prevStatsTime > 0 && bytesSent > this._prevBytesSent) {
        const elapsed = (now - this._prevStatsTime) / 1000;
        this._currentBitrate = ((bytesSent - this._prevBytesSent) * 8) / elapsed;
      }
      this._prevBytesSent = bytesSent;
      this._prevStatsTime = now;
    } catch {
      // stats collection may fail after producer is closed
    }
  }
}
