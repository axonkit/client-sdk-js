import { LocalTrack } from './LocalTrack';
import { TrackKind, TrackSource } from '../protocol/types';

export class LocalAudioTrack extends LocalTrack {
  constructor(
    mediaStreamTrack: MediaStreamTrack,
    constraints?: MediaTrackConstraints,
  ) {
    super(TrackKind.Audio, mediaStreamTrack, TrackSource.Microphone, constraints);
  }

  async setDeviceId(deviceId: string): Promise<void> {
    await this.restart({ ...(this.constraints ?? {}), deviceId: { exact: deviceId } });
  }
}
