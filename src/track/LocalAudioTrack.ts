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

  constructor(mediaStreamTrack: MediaStreamTrack, constraints?: MediaTrackConstraints) {
    super(TrackKind.Audio, mediaStreamTrack, TrackSource.Microphone, constraints);
  }

  override async mute(): Promise<typeof this> {
    await super.mute();
    if (this.stopOnMute) {
      this.mediaStreamTrack.stop();
    }
    return this;
  }

  override async unmute(): Promise<typeof this> {
    if (this.pendingRestartConstraints) {
      log.debug('applying pending device change on unmute');
      await this.restart(this.pendingRestartConstraints);
      this.pendingRestartConstraints = undefined;
    } else if (this.stopOnMute && this.mediaStreamTrack.readyState === 'ended') {
      await this.restart();
    }
    await super.unmute();
    return this;
  }

  async setDeviceId(deviceId: string): Promise<void> {
    const newConstraints = { ...(this.constraints ?? {}), deviceId: { exact: deviceId } };

    if (this.isMuted) {
      log.debug('track is muted, deferring device change to unmute');
      this.pendingRestartConstraints = newConstraints;
      return;
    }

    await this.restart(newConstraints);
  }
}
