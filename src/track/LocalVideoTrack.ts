import { LocalTrack } from './LocalTrack';
import { TrackKind, TrackSource, VideoQuality } from '../protocol/types';
import type { VideoEncoding, VideoResolution } from './options';
import { videoSimulcastPresets, defaultVideoEncoding } from './options';
import { getLogger } from '../utils/logger';
import { isFireFox } from '../utils/browser';

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

  /**
   * Applies dynacast quality updates from the server.
   *
   * - Simulcast: toggles each encoding's `active` by rid.
   * - SVC (single encoding): sets `active = false` only when ALL qualities
   *   are disabled; otherwise keeps it `true`.
   */
  async setDynacastQuality(
    qualities: { quality: VideoQuality; enabled: boolean }[],
  ): Promise<void> {
    const sender = this.producer?.rtpSender;
    if (!sender) return;

    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return;

    let changed = false;
    if (params.encodings.length > 1) {
      const presets = this.getSimulcastEncodings();
      for (const q of qualities) {
        const rid = QUALITY_RID_MAP[q.quality];
        const enc = params.encodings.find((e) => e.rid === rid);
        if (enc) {
          if ((enc.active ?? true) !== q.enabled) {
            enc.active = q.enabled;
            changed = true;
          }
          // FireFox does not support setting encoding.active to false, so we
          // have a workaround of lowering its bitrate and resolution to the min.
          if (isFireFox()) {
            if (q.enabled) {
              const preset = presets.find((p) => p.rid === rid);
              if (preset) {
                enc.scaleResolutionDownBy = preset.scaleResolutionDownBy;
                enc.maxBitrate = preset.maxBitrate;
                enc.maxFramerate = preset.maxFramerate;
              }
            } else {
              enc.scaleResolutionDownBy = 4;
              enc.maxBitrate = 10;
              enc.maxFramerate = 2;
            }
          }
        }
      }
    } else {
      const shouldBeActive = qualities.some((q) => q.enabled);
      if ((params.encodings[0].active ?? true) !== shouldBeActive) {
        params.encodings[0].active = shouldBeActive;
        changed = true;
      }
    }

    if (changed) {
      await sender.setParameters(params);
      const detail = qualities.map((q) => `${q.quality}=${q.enabled}`).join(',');
      log.debug(`Dynacast quality updated for ${this.sid ?? 'unknown'}: [${detail}]`);
    }
  }

  async setDeviceId(deviceId: string): Promise<void> {
    await this.restart({ ...(this.constraints ?? {}), deviceId: { exact: deviceId } });
  }
}
