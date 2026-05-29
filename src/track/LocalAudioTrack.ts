import { Mutex } from 'async-mutex';
import { LocalTrack } from './LocalTrack';
import { TrackKind, TrackSource } from '../protocol/types';
import { getLogger } from '../utils/logger';

const log = getLogger('LocalAudioTrack');

export class LocalAudioTrack extends LocalTrack {
  /**
   * When `true`, the underlying `MediaStreamTrack` is stopped when the track
   * is muted and restarted when unmuted. Useful for disabling the microphone
   * recording indicator on some platforms.
   */
  stopOnMute = false;

  /**
   * Pending constraints to apply on the next unmute. Used when the user
   * switches devices while the track is muted — the actual restart is
   * deferred until unmute.
   */
  private pendingRestartConstraints?: MediaTrackConstraints;

  private muteLock = new Mutex();

  constructor(mediaStreamTrack: MediaStreamTrack, constraints?: MediaTrackConstraints) {
    super(TrackKind.Audio, mediaStreamTrack, TrackSource.Microphone, constraints);
  }

  override async mute(): Promise<void> {
    const release = await this.muteLock.acquire();
    try {
      if (this.isMuted) return;
      if (this.stopOnMute && !this.isUserProvided) {
        this._mediaStreamTrack.stop();
      }
      super.mute();
    } finally {
      release();
    }
  }

  override async unmute(): Promise<void> {
    const release = await this.muteLock.acquire();
    try {
      if (!this.isMuted) return;
      if (this.pendingRestartConstraints) {
        log.debug('applying pending device change on unmute');
        await this.restart(this.pendingRestartConstraints);
        this.pendingRestartConstraints = undefined;
      } else if (
        (this.stopOnMute || this._mediaStreamTrack.readyState === 'ended') &&
        !this.isUserProvided
      ) {
        await this.restart();
      }
      super.unmute();
    } finally {
      release();
    }
  }

  async setDeviceId(deviceId: string, exact = true): Promise<void> {
    const constraint = exact ? { exact: deviceId } : deviceId;
    const newConstraints = { ...(this.constraints ?? {}), deviceId: constraint };

    if (this.isMuted) {
      log.debug('track is muted, deferring device change to unmute');
      this.pendingRestartConstraints = newConstraints;
      return;
    }

    await this.restart(newConstraints);
  }
}
