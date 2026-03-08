import { Track, type TrackEvents } from './Track';
import { TrackKind, TrackSource } from '../protocol/types';
import { TrackEvent } from '../events';
import { getLogger } from '../utils/logger';
import { types as mediasoupTypes } from 'mediasoup-client';
import type { TrackProcessor, ProcessorOptions } from './processor/types';

const log = getLogger('LocalTrack');

export interface LocalTrackEvents extends TrackEvents {
  [TrackEvent.Restarted]: (track: LocalTrack) => void;
}

export class LocalTrack extends Track {
  protected constraints?: MediaTrackConstraints;
  private _producer?: mediasoupTypes.Producer;
  private _processor?: TrackProcessor;

  constructor(
    kind: TrackKind,
    mediaStreamTrack: MediaStreamTrack,
    name?: string,
    source?: TrackSource,
    constraints?: MediaTrackConstraints,
  ) {
    super(
      kind,
      name ?? mediaStreamTrack.label,
      source ?? TrackSource.Unknown,
      mediaStreamTrack,
    );
    this.constraints = constraints;
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
   * Set a {@link TrackProcessor} on this track. The processor transforms the
   * underlying `MediaStreamTrack` and the processed output is sent to the
   * producer instead. Pass `undefined` to remove the current processor.
   *
   * @experimental
   */
  async setProcessor(processor: TrackProcessor | undefined): Promise<void> {
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

    if (processor.processedTrack && this._producer) {
      await this._producer.replaceTrack({ track: processor.processedTrack });
    }
  }

  async restart(constraints?: MediaTrackConstraints): Promise<void> {
    if (constraints) {
      this.constraints = constraints;
    }

    const kind = this.kind === TrackKind.Audio ? 'audio' : 'video';
    const stream = await navigator.mediaDevices.getUserMedia({
      [kind]: this.constraints ?? true,
    });

    const newTrack = kind === 'audio'
      ? stream.getAudioTracks()[0]
      : stream.getVideoTracks()[0];

    if (!newTrack) throw new Error('Failed to get new media track');

    await this.replaceTrack(newTrack);
    log.info(`Track ${this.name} restarted`);
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

    oldTrack?.stop();
  }

  stop(): void {
    if (this._processor) {
      this._processor.destroy().catch(() => {});
      this._processor = undefined;
    }
    super.stop();
    log.debug(`Track ${this.name} stopped`);
  }
}
