import { LocalTrack } from './LocalTrack';
import { LocalAudioTrack } from './LocalAudioTrack';
import { LocalVideoTrack } from './LocalVideoTrack';
import { TrackSource } from '../protocol/types';
import {
  defaultAudioCaptureOptions,
  defaultVideoCaptureOptions,
  type AudioCaptureOptions,
  type VideoCaptureOptions,
  type ScreenShareCaptureOptions,
  type CreateLocalTracksOptions,
} from './options';

function audioConstraints(opts: AudioCaptureOptions | true): MediaTrackConstraints {
  if (opts === true) opts = defaultAudioCaptureOptions;
  return {
    echoCancellation: opts.echoCancellation,
    noiseSuppression: opts.noiseSuppression,
    autoGainControl: opts.autoGainControl,
    deviceId: opts.deviceId,
    channelCount: opts.channelCount,
    sampleRate: opts.sampleRate,
    sampleSize: opts.sampleSize,
  };
}

function videoConstraints(opts: VideoCaptureOptions | true): MediaTrackConstraints {
  if (opts === true) opts = defaultVideoCaptureOptions;
  return {
    width: opts.resolution?.width,
    height: opts.resolution?.height,
    frameRate: opts.frameRate,
    facingMode: opts.facingMode,
    deviceId: opts.deviceId,
  };
}

/**
 * Create local audio and video tracks with the given options.
 *
 * @param options - Capture options for audio and video. Defaults to
 *   `{ audio: true, video: true }`.
 * @returns An array of created local tracks.
 */
export async function createLocalTracks(
  options: CreateLocalTracksOptions = { audio: true, video: true },
): Promise<LocalTrack[]> {
  const constraints: MediaStreamConstraints = {};
  if (options.audio) constraints.audio = audioConstraints(options.audio);
  if (options.video) constraints.video = videoConstraints(options.video);

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const tracks: LocalTrack[] = [];

  for (const at of stream.getAudioTracks()) {
    tracks.push(new LocalAudioTrack(at, constraints.audio as MediaTrackConstraints));
  }
  for (const vt of stream.getVideoTracks()) {
    tracks.push(
      new LocalVideoTrack(vt, TrackSource.Camera, constraints.video as MediaTrackConstraints),
    );
  }

  return tracks;
}

/**
 * Create a local audio track from the microphone.
 *
 * @param options - Audio capture options. Uses defaults when omitted.
 */
export async function createLocalAudioTrack(
  options?: AudioCaptureOptions,
): Promise<LocalAudioTrack> {
  const constraints = audioConstraints(options ?? defaultAudioCaptureOptions);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  const track = stream.getAudioTracks()[0];
  return new LocalAudioTrack(track, constraints);
}

/**
 * Create a local video track from the camera.
 *
 * @param options - Video capture options. Uses defaults when omitted.
 */
export async function createLocalVideoTrack(
  options?: VideoCaptureOptions,
): Promise<LocalVideoTrack> {
  const constraints = videoConstraints(options ?? defaultVideoCaptureOptions);
  const stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
  const track = stream.getVideoTracks()[0];
  return new LocalVideoTrack(track, TrackSource.Camera, constraints);
}

/**
 * Create local screen share tracks (video and optionally audio).
 *
 * @param options - Screen share capture options.
 */
export async function createLocalScreenTracks(
  options?: ScreenShareCaptureOptions,
): Promise<LocalTrack[]> {
  const constraints: DisplayMediaStreamOptions = {
    video:
      options?.video ??
      ({
        width: options?.resolution?.width,
        height: options?.resolution?.height,
        frameRate: options?.frameRate,
      } as MediaTrackConstraints),
    audio: options?.audio
      ? typeof options.audio === 'boolean'
        ? true
        : audioConstraints(options.audio)
      : false,
  };

  const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
  const tracks: LocalTrack[] = [];

  for (const vt of stream.getVideoTracks()) {
    tracks.push(new LocalVideoTrack(vt, TrackSource.ScreenShare));
  }
  for (const at of stream.getAudioTracks()) {
    const audioTrack = new LocalAudioTrack(at);
    audioTrack.source = TrackSource.ScreenShareAudio;
    tracks.push(audioTrack);
  }

  return tracks;
}
