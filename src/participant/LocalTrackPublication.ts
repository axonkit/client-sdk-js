import { types as mediasoupTypes } from 'mediasoup-client';
import { TrackPublication } from './Participant';
import type { LocalTrack } from '../track/LocalTrack';
import type { TrackSource, TrackInfo } from '../protocol/types';
import { AudioTrackFeature, TrackKind } from '../protocol/types';
import type { TrackPublishOptions } from '../track/options';
import { getLogger } from '../utils/logger';

const log = getLogger('LocalTrackPublication');

export class LocalTrackPublication extends TrackPublication {
  /** @internal */
  producer?: mediasoupTypes.Producer;

  /** The options used when publishing the track. */
  options?: TrackPublishOptions;

  /** @internal */
  constructor(init: {
    trackSid: string;
    trackName: string;
    kind: string;
    source: TrackSource;
    track?: LocalTrack;
    muted: boolean;
    info?: TrackInfo;
    producer?: mediasoupTypes.Producer;
    options?: TrackPublishOptions;
  }) {
    super(init);
    this.producer = init.producer;
    this.options = init.options;
  }

  override get isLocal(): boolean {
    return true;
  }

  override get isMuted(): boolean {
    const localTrack = this.track as LocalTrack | undefined;
    if (localTrack) {
      return localTrack.isMuted;
    }
    return super.isMuted;
  }

  /** Whether upstream publishing is paused for this track. */
  get isUpstreamPaused(): boolean {
    return (this.track as LocalTrack | undefined)?.isUpstreamPaused ?? false;
  }

  /** Mute the track associated with this publication. */
  mute(): void {
    const localTrack = this.track as LocalTrack | undefined;
    // LocalAudioTrack.mute() is async (may stop the source track) — don't
    // leave its rejection unhandled.
    Promise.resolve(localTrack?.mute()).catch((err) => {
      log.warn('Failed to mute track', err);
    });
  }

  /** Unmute the track associated with this publication. */
  unmute(): void {
    const localTrack = this.track as LocalTrack | undefined;
    // LocalAudioTrack.unmute() may restart the capture device and reject.
    Promise.resolve(localTrack?.unmute()).catch((err) => {
      log.warn('Failed to unmute track', err);
    });
  }

  /**
   * Pause publishing to the server without disabling the local MediaStreamTrack.
   */
  async pauseUpstream(): Promise<void> {
    await (this.track as LocalTrack | undefined)?.pauseUpstream();
  }

  /**
   * Resume publishing after a call to {@link pauseUpstream}.
   */
  async resumeUpstream(): Promise<void> {
    await (this.track as LocalTrack | undefined)?.resumeUpstream();
  }

  /**
   * Returns a list of audio track features detected from the current track settings.
   * Only applicable to audio tracks.
   */
  getTrackFeatures(): AudioTrackFeature[] {
    if (this.kind !== TrackKind.Audio || !this.track) return [];
    const settings = this.track.mediaStreamTrack.getSettings();
    const features: Set<AudioTrackFeature> = new Set();
    if (settings.autoGainControl) {
      features.add(AudioTrackFeature.AutoGainControl);
    }
    if (settings.echoCancellation) {
      features.add(AudioTrackFeature.EchoCancellation);
    }
    if (settings.noiseSuppression) {
      features.add(AudioTrackFeature.NoiseSuppression);
    }
    if (settings.channelCount && settings.channelCount > 1) {
      features.add(AudioTrackFeature.Stereo);
    }
    if (this.options && !this.options.dtx) {
      features.add(AudioTrackFeature.NoDtx);
    }
    return Array.from(features);
  }
}
