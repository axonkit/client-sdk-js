import { LocalTrack } from './LocalTrack';
import { TrackKind, TrackSource } from '../protocol/types';

export class LocalAudioTrack extends LocalTrack {
  /**
   * When `true`, the underlying `MediaStreamTrack` is stopped when the track
   * is muted and restarted when unmuted. Useful for disabling the microphone
   * recording indicator on some platforms.
   */
  stopOnMute = false;

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
    if (this.stopOnMute && this.mediaStreamTrack.readyState === 'ended') {
      await this.restart();
    }
    await super.unmute();
    return this;
  }

  async setDeviceId(deviceId: string): Promise<void> {
    await this.restart({ ...(this.constraints ?? {}), deviceId: { exact: deviceId } });
  }
}
