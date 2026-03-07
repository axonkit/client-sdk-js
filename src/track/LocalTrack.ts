import { Track, type TrackEvents } from './Track';
import { TrackKind, TrackSource } from '../protocol/types';
import { TrackEvent } from '../events';
import { getLogger } from '../utils/logger';
import { types as mediasoupTypes } from 'mediasoup-client';

const log = getLogger('LocalTrack');

export interface LocalTrackEvents extends TrackEvents {
  [TrackEvent.Restarted]: (track: LocalTrack) => void;
}

export class LocalTrack extends Track {
  protected constraints?: MediaTrackConstraints;
  private _producer?: mediasoupTypes.Producer;

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

    if (this._producer) {
      await this._producer.replaceTrack({ track: newTrack });
    }

    // Reattach to all existing elements
    for (const el of this.attachedElements) {
      const stream = new MediaStream([newTrack]);
      el.srcObject = stream;
    }

    oldTrack?.stop();
  }

  stop(): void {
    super.stop();
    log.debug(`Track ${this.name} stopped`);
  }
}
