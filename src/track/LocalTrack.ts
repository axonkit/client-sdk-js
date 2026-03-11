import { Mutex } from 'async-mutex';
import { Track, type TrackDimensions, type TrackEvents } from './Track';
import { TrackKind, TrackSource } from '../protocol/types';
import { TrackEvent } from '../events';
import { getLogger } from '../utils/logger';
import { getBrowser, isSafariBased, isWeb, isMobile } from '../utils/browser';
import { types as mediasoupTypes } from 'mediasoup-client';
import type { TrackProcessor, ProcessorOptions } from './processor/types';

const log = getLogger('LocalTrack');

const MONITOR_FREQUENCY = 2000;
const DEFAULT_DIMENSIONS_TIMEOUT = 1000;

export type LocalTrackEvents = TrackEvents & {
  [TrackEvent.Restarted]: (track: LocalTrack) => void;
};

export class LocalTrack extends Track {
  private _constraints?: MediaTrackConstraints;
  private _producer?: mediasoupTypes.Producer;
  protected _processor?: TrackProcessor;
  protected processorElement?: HTMLMediaElement;
  private _isUpstreamPaused = false;
  private _providedByUser = false;
  private _prevBytesSent = 0;
  private _prevStatsTime = 0;
  private _mediaTrackMuteDebounce: ReturnType<typeof setTimeout> | undefined;
  private _handleVisibilityChange = this.onVisibilityChange.bind(this);

  protected trackChangeLock = new Mutex();
  protected pauseUpstreamLock = new Mutex();

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
    this.attachMediaTrackListeners(mediaStreamTrack);
  }

  /**
   * Returns the processed track if a processor is active, otherwise the
   * raw source track. Consumers should use this for playback and
   * publishing.
   */
  override get mediaStreamTrack(): MediaStreamTrack {
    return this._processor?.processedTrack ?? this._mediaStreamTrack;
  }

  get isLocal(): boolean {
    return true;
  }

  /** The MediaStreamTrack id. */
  get id(): string {
    return this._mediaStreamTrack.id;
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
   * Returns the settings of the *original* source track, ignoring any
   * active processor.  Useful when you need the real capture resolution
   * or device info regardless of post-processing.
   */
  getSourceTrackSettings(): MediaTrackSettings {
    return this._mediaStreamTrack.getSettings();
  }

  /**
   * Set a {@link TrackProcessor} on this track. Pass `undefined` to remove
   * the current processor.
   */
  async setProcessor(
    processor: TrackProcessor | undefined,
    showProcessedStreamLocally = true,
  ): Promise<void> {
    const release = await this.trackChangeLock.acquire();
    try {
      if (this._processor) {
        await this._processor.destroy();
        this._processor = undefined;
      }

      if (!processor) {
        this.destroyProcessorElement();
        if (this._producer) {
          await this._producer.replaceTrack({ track: this._mediaStreamTrack });
        }
        this.reattachElementsToTrack(this._mediaStreamTrack);
        return;
      }

      this.ensureProcessorElement();

      const opts: ProcessorOptions = {
        kind: this.kind,
        track: this._mediaStreamTrack,
        element: this.processorElement,
      };
      await processor.init(opts);

      this._processor = processor;

      const outputTrack = processor.processedTrack ?? this._mediaStreamTrack;
      if (showProcessedStreamLocally) {
        this.reattachElementsToTrack(outputTrack);
      }
      if (this._producer) {
        await this._producer.replaceTrack({ track: outputTrack });
      }
    } finally {
      release();
    }
  }

  /** Stop and remove the current processor. */
  async stopProcessor(): Promise<void> {
    const release = await this.trackChangeLock.acquire();
    try {
      if (!this._processor) return;

      this._processor.processedTrack?.stop();
      await this._processor.destroy();
      this._processor = undefined;
      this.destroyProcessorElement();

      if (this._producer) {
        await this._producer.replaceTrack({ track: this._mediaStreamTrack });
      }
      this.reattachElementsToTrack(this._mediaStreamTrack);
    } finally {
      release();
    }
  }

  /** Mute the track (disables the MediaStreamTrack). */
  mute(): void {
    this.setTrackMuted(true);
  }

  /** Unmute the track (enables the MediaStreamTrack). */
  unmute(): void {
    this.setTrackMuted(false);
  }

  /**
   * Pause publishing to the server without disabling the local
   * MediaStreamTrack. Useful for showing a local preview while
   * not sending to remote participants.
   */
  async pauseUpstream(): Promise<void> {
    const release = await this.pauseUpstreamLock.acquire();
    try {
      if (this._isUpstreamPaused) return;
      if (!this._producer) {
        log.warn('Cannot pause upstream for an unpublished track');
        return;
      }
      this._isUpstreamPaused = true;
      await this._producer.replaceTrack({ track: null as any });
      this.emit(TrackEvent.UpstreamPaused, this);
    } finally {
      release();
    }
  }

  /** Resume publishing after a call to {@link pauseUpstream}. */
  async resumeUpstream(): Promise<void> {
    const release = await this.pauseUpstreamLock.acquire();
    try {
      if (!this._isUpstreamPaused) return;
      if (!this._producer) {
        log.warn('Cannot resume upstream for an unpublished track');
        return;
      }
      this._isUpstreamPaused = false;
      const trackToSend = this._processor?.processedTrack ?? this.mediaStreamTrack;
      await this._producer.replaceTrack({ track: trackToSend });
      this.emit(TrackEvent.UpstreamResumed, this);
    } finally {
      release();
    }
  }

  /**
   * Gets the RTCStatsReport for the underlying RTP sender.
   */
  async getRTCStatsReport(): Promise<RTCStatsReport | undefined> {
    if (!this._producer) return undefined;
    return this._producer.getStats();
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

    // iOS browsers report wrong initial resolution; a short delay fixes it.
    if (getBrowser()?.os === 'iOS') {
      await new Promise((r) => setTimeout(r, 10));
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
    const release = await this.trackChangeLock.acquire();
    try {
      if (constraints) {
        this._constraints = constraints;
      }

      const kind = this.kind === TrackKind.Audio ? 'audio' : 'video';

      // Safari requires stopping the old audio track before acquiring a new
      // one, otherwise it may throw "MediaStreamTrack ended due to capture failure".
      if (kind === 'audio' && isSafariBased()) {
        this._mediaStreamTrack?.stop();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        [kind]: this._constraints ?? true,
      });

      const newTrack = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];

      if (!newTrack) throw new Error('Failed to get new media track');

      await this.replaceTrackInternal(newTrack);
      log.info(`Track ${this.sid ?? 'unknown'} restarted`);
      (this as any).emit(TrackEvent.Restarted, this);
    } finally {
      release();
    }
  }

  async replaceTrack(newTrack: MediaStreamTrack): Promise<void> {
    const release = await this.trackChangeLock.acquire();
    try {
      await this.replaceTrackInternal(newTrack);
    } finally {
      release();
    }
  }

  /** Internal replace without acquiring trackChangeLock (caller must hold it). */
  private async replaceTrackInternal(newTrack: MediaStreamTrack): Promise<void> {
    this.detachMediaTrackListeners(this._mediaStreamTrack);
    const oldTrack = this._mediaStreamTrack;
    this._mediaStreamTrack = newTrack;
    this.attachMediaTrackListeners(newTrack);

    // Reattach source track to the processorElement so the processor
    // can read from the new source.
    if (this.processorElement) {
      this.attachTrackToProcessorElement(newTrack);
    }

    let trackForProducer = newTrack;
    if (this._processor) {
      await this._processor.restart({
        kind: this.kind,
        track: newTrack,
        element: this.processorElement,
      });
      if (this._processor.processedTrack) {
        trackForProducer = this._processor.processedTrack;
      }
    }

    if (this._producer) {
      await this._producer.replaceTrack({ track: trackForProducer });
    }

    const displayTrack = this._processor?.processedTrack ?? newTrack;
    this.reattachElementsToTrack(displayTrack);

    if (!this._providedByUser) {
      oldTrack?.stop();
    }
  }

  stop(): void {
    this.detachMediaTrackListeners(this._mediaStreamTrack);
    this.removeVisibilityListener();
    if (this._mediaTrackMuteDebounce) {
      clearTimeout(this._mediaTrackMuteDebounce);
      this._mediaTrackMuteDebounce = undefined;
    }
    if (this._processor) {
      this._processor.destroy().catch(() => {});
      this._processor = undefined;
    }
    this.destroyProcessorElement();
    this._mediaStreamTrack?.stop();
    super.stop();
    log.debug(`Track ${this.sid ?? 'unknown'} stopped`);
  }

  protected setTrackMuted(muted: boolean): void {
    if (this._isMuted === muted) return;
    this._isMuted = muted;
    this._mediaStreamTrack.enabled = !muted;
    if (this._producer) {
      if (muted) {
        this._producer.pause();
      } else {
        this._producer.resume();
      }
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

  // --- MediaStreamTrack mute/unmute listeners ---

  private attachMediaTrackListeners(track: MediaStreamTrack): void {
    track.addEventListener('mute', this.onMediaTrackMute);
    track.addEventListener('unmute', this.onMediaTrackUnmute);
  }

  private detachMediaTrackListeners(track: MediaStreamTrack): void {
    track.removeEventListener('mute', this.onMediaTrackMute);
    track.removeEventListener('unmute', this.onMediaTrackUnmute);
  }

  private onMediaTrackMute = (): void => {
    // Hardware/system may mute the track (e.g. bluetooth disconnect).
    // Debounce to avoid rapid toggling.
    if (this._mediaTrackMuteDebounce) clearTimeout(this._mediaTrackMuteDebounce);
    this._mediaTrackMuteDebounce = setTimeout(() => {
      if (this.mediaStreamTrack.muted) {
        log.debug(`MediaStreamTrack muted by system for ${this.sid ?? 'unknown'}`);
        this.pauseUpstream().catch(() => {});
      }
    }, 200);
  };

  private onMediaTrackUnmute = (): void => {
    if (this._mediaTrackMuteDebounce) {
      clearTimeout(this._mediaTrackMuteDebounce);
      this._mediaTrackMuteDebounce = undefined;
    }
    if (this._isUpstreamPaused) {
      log.debug(`MediaStreamTrack unmuted by system for ${this.sid ?? 'unknown'}`);
      this.resumeUpstream().catch(() => {});
    }
  };

  // --- App visibility ---

  /** Start listening for visibility changes (should be called after publishing). */
  addVisibilityListener(): void {
    if (!isWeb() || !isMobile()) return;
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
  }

  private removeVisibilityListener(): void {
    if (!isWeb()) return;
    document.removeEventListener('visibilitychange', this._handleVisibilityChange);
  }

  private async onVisibilityChange(): Promise<void> {
    if (document.visibilityState !== 'visible') return;
    // When returning to foreground on mobile, the track may have been
    // released by the OS. Try to restart it if the track has ended.
    if (this._mediaStreamTrack.readyState === 'ended' && !this._providedByUser) {
      log.info(`Track ${this.sid ?? 'unknown'} ended while in background, restarting`);
      try {
        await this.restart();
      } catch (err) {
        log.warn(`Failed to restart track after visibility change`, err);
      }
    }
  }

  // --- processorElement lifecycle ---

  /**
   * Ensures a hidden HTMLMediaElement exists for the processor to read
   * frames from the source track. Reuses the existing element if present.
   */
  private ensureProcessorElement(): void {
    if (this.processorElement) {
      this.attachTrackToProcessorElement(this._mediaStreamTrack);
      return;
    }
    const el = document.createElement(
      this.kind === TrackKind.Audio ? 'audio' : 'video',
    );
    el.muted = true;
    el.autoplay = true;
    if (el instanceof HTMLVideoElement) {
      el.playsInline = true;
    }
    // Keep the element out of the visible layout
    el.style.width = '0';
    el.style.height = '0';
    el.style.position = 'absolute';
    el.style.opacity = '0';

    this.attachTrackToProcessorElement(this._mediaStreamTrack, el);
    el.play().catch(() => {});
    this.processorElement = el;
  }

  private attachTrackToProcessorElement(
    track: MediaStreamTrack,
    el?: HTMLMediaElement,
  ): void {
    const target = el ?? this.processorElement;
    if (!target) return;
    target.srcObject = new MediaStream([track]);
  }

  private destroyProcessorElement(): void {
    if (!this.processorElement) return;
    this.processorElement.srcObject = null;
    this.processorElement.remove();
    this.processorElement = undefined;
  }

  /** Re-attach all user-facing elements to the given track. */
  private reattachElementsToTrack(track: MediaStreamTrack): void {
    for (const el of this.attachedElements) {
      el.srcObject = new MediaStream([track]);
    }
  }
}
