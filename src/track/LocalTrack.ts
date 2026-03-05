import { Track, type TrackEvents } from './Track';
import { TrackKind, TrackSource } from '../protocol/types';
import { getLogger } from '../utils/logger';

const log = getLogger('LocalTrack');

export interface LocalTrackEvents extends TrackEvents {
  restarted: (track: LocalTrack) => void;
}

export class LocalTrack extends Track {
  protected constraints?: MediaTrackConstraints;
  private _sender?: RTCRtpSender;

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

    mediaStreamTrack.addEventListener('ended', () => {
      this.emit('ended', this);
    });
  }

  get sender(): RTCRtpSender | undefined {
    return this._sender;
  }

  set sender(s: RTCRtpSender | undefined) {
    this._sender = s;
  }

  async mute(): Promise<void> {
    if (this.isMuted) return;
    this.isMuted = true;
    if (this.mediaStreamTrack) {
      this.mediaStreamTrack.enabled = false;
    }
    this.emit('muted', this);
    log.debug(`Track ${this.name} muted`);
  }

  async unmute(): Promise<void> {
    if (!this.isMuted) return;
    this.isMuted = false;
    if (this.mediaStreamTrack) {
      this.mediaStreamTrack.enabled = true;
    }
    this.emit('unmuted', this);
    log.debug(`Track ${this.name} unmuted`);
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
    (this as any).emit('restarted', this);
  }

  async replaceTrack(newTrack: MediaStreamTrack): Promise<void> {
    const oldTrack = this.mediaStreamTrack;
    this.mediaStreamTrack = newTrack;

    if (this._sender) {
      await this._sender.replaceTrack(newTrack);
    }

    // Reattach to all existing elements
    for (const el of this.attachedElements) {
      const stream = new MediaStream([newTrack]);
      el.srcObject = stream;
    }

    oldTrack?.stop();

    newTrack.addEventListener('ended', () => {
      this.emit('ended', this);
    });
  }

  stop(): void {
    super.stop();
    log.debug(`Track ${this.name} stopped`);
  }
}
