import { RemoteTrack } from './RemoteTrack';
import { TrackKind, TrackSource } from '../protocol/types';

export class RemoteAudioTrack extends RemoteTrack {
  private _volume = 1;

  constructor(mediaStreamTrack: MediaStreamTrack) {
    super(TrackKind.Audio, TrackSource.Microphone, mediaStreamTrack);
  }

  get volume(): number {
    return this._volume;
  }

  setVolume(volume: number): void {
    this._volume = Math.max(0, Math.min(1, volume));
    for (const el of this.attachedElements) {
      (el as HTMLAudioElement).volume = this._volume;
    }
  }
}
