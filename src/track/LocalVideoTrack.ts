import { LocalTrack } from './LocalTrack';
import { TrackKind, TrackSource, VideoQuality } from '../protocol/types';
import type { VideoEncoding, VideoResolution } from './options';
import { videoSimulcastPresets, defaultVideoEncoding } from './options';
import { getLogger } from '../utils/logger';

const log = getLogger('LocalVideoTrack');

const QUALITY_RID_MAP: Record<number, string> = {
  [VideoQuality.LOW]: 'q',
  [VideoQuality.MEDIUM]: 'h',
  [VideoQuality.HIGH]: 'f',
};

export class LocalVideoTrack extends LocalTrack {
  private simulcast = false;
  private encoding?: VideoEncoding;

  constructor(
    mediaStreamTrack: MediaStreamTrack,
    source: TrackSource = TrackSource.Camera,
    constraints?: MediaTrackConstraints,
  ) {
    super(TrackKind.Video, mediaStreamTrack, source, constraints);
  }

  get dimensions(): VideoResolution | undefined {
    const settings = this.mediaStreamTrack?.getSettings();
    if (settings?.width && settings?.height) {
      return { width: settings.width, height: settings.height };
    }
    return undefined;
  }

  setSimulcast(enabled: boolean): void {
    this.simulcast = enabled;
  }

  setEncoding(encoding: VideoEncoding): void {
    this.encoding = encoding;
  }

  getSimulcastEncodings(): RTCRtpEncodingParameters[] {
    if (!this.simulcast) {
      const enc = this.encoding ?? defaultVideoEncoding;
      return [{ maxBitrate: enc.maxBitrate, maxFramerate: enc.maxFramerate }];
    }

    return [
      {
        rid: 'q',
        maxBitrate: videoSimulcastPresets.h180.maxBitrate,
        maxFramerate: videoSimulcastPresets.h180.maxFramerate,
        scaleResolutionDownBy: 4,
      },
      {
        rid: 'h',
        maxBitrate: videoSimulcastPresets.h360.maxBitrate,
        maxFramerate: videoSimulcastPresets.h360.maxFramerate,
        scaleResolutionDownBy: 2,
      },
      {
        rid: 'f',
        maxBitrate: (this.encoding ?? videoSimulcastPresets.h720).maxBitrate,
        maxFramerate: (this.encoding ?? videoSimulcastPresets.h720).maxFramerate,
      },
    ];
  }

  async setDynacastQuality(qualities: { quality: VideoQuality; enabled: boolean }[]): Promise<void> {
    if (!this.producer) return;

    // Mediasoup producer does not expose getParameters/setParameters directly on Producer type?
    // It does, but we need to check types.
    // Actually, Mediasoup Producer wraps RTCRtpSender, but doesn't expose setParameters easily?
    // Wait, mediasoup-client Producer has `rtpSender` property.
    
    const sender = this.producer.rtpSender;
    if (!sender) return;

    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return;

    for (const q of qualities) {
      const rid = QUALITY_RID_MAP[q.quality];
      const encoding = params.encodings.find((e) => e.rid === rid);
      if (encoding) {
        encoding.active = q.enabled;
      }
    }

    await sender.setParameters(params);
    log.debug(`Dynacast quality updated for ${this.sid ?? 'unknown'}`);
  }

  async setSubscriptionStatus(hasSubscribers: boolean): Promise<void> {
    if (!this.producer) return;

    if (hasSubscribers) {
      this.producer.resume();
    } else {
      this.producer.pause();
    }
    log.debug(`Subscription status: hasSubscribers=${hasSubscribers} for ${this.sid ?? 'unknown'}`);
  }

  async setDeviceId(deviceId: string): Promise<void> {
    await this.restart({ ...(this.constraints ?? {}), deviceId: { exact: deviceId } });
  }
}
