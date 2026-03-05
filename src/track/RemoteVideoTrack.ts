import { RemoteTrack } from './RemoteTrack';
import { TrackKind, TrackSource } from '../protocol/types';

export class RemoteVideoTrack extends RemoteTrack {
  adaptiveStreamEnabled = false;

  constructor(name: string, source: TrackSource = TrackSource.Camera, mediaStreamTrack?: MediaStreamTrack) {
    super(TrackKind.Video, name, source, mediaStreamTrack);
  }
}
