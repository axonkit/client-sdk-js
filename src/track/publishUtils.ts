import type { TrackPublishOptions, VideoCodec, VideoEncoding } from './options';
import {
  VideoPreset,
  VideoPresets,
  VideoPresets43,
  ScreenSharePresets,
} from './options';
import { TrackSource } from '../protocol/types';
import { getLogger } from '../utils/logger';

const log = getLogger('publishUtils');

const videoRids = ['q', 'h', 'f'];

const presets169 = Object.values(VideoPresets);
const presets43 = Object.values(VideoPresets43);
const presetsScreenShare = Object.values(ScreenSharePresets);

const defaultSimulcastPresets169 = [VideoPresets.h180, VideoPresets.h360];
const defaultSimulcastPresets43 = [VideoPresets43.h180, VideoPresets43.h360];

export function isSVCCodec(codec?: string): boolean {
  return codec === 'av1' || codec === 'vp9';
}

function computeDefaultScreenShareSimulcastPresets(fromPreset: VideoPreset): VideoPreset[] {
  const layers = [{ scaleResolutionDownBy: 2, fps: fromPreset.encoding.maxFramerate }];
  return layers.map(
    (t) =>
      new VideoPreset(
        Math.floor(fromPreset.width / t.scaleResolutionDownBy),
        Math.floor(fromPreset.height / t.scaleResolutionDownBy),
        Math.max(
          150_000,
          Math.floor(
            fromPreset.encoding.maxBitrate /
              (t.scaleResolutionDownBy ** 2 *
                ((fromPreset.encoding.maxFramerate ?? 30) / (t.fps ?? 30))),
          ),
        ),
        t.fps,
        fromPreset.encoding.priority,
      ),
  );
}

function presetsForResolution(
  isScreenShare: boolean,
  width: number,
  height: number,
): VideoPreset[] {
  if (isScreenShare) {
    return presetsScreenShare;
  }
  const aspect = width > height ? width / height : height / width;
  if (Math.abs(aspect - 16.0 / 9) < Math.abs(aspect - 4.0 / 3)) {
    return presets169;
  }
  return presets43;
}

export function determineAppropriateEncoding(
  isScreenShare: boolean,
  width: number,
  height: number,
  codec?: VideoCodec,
): VideoEncoding {
  const presets = presetsForResolution(isScreenShare, width, height);
  let { encoding } = presets[0];

  const size = Math.max(width, height);

  for (let i = 0; i < presets.length; i += 1) {
    const preset = presets[i];
    encoding = preset.encoding;
    if (preset.width >= size) {
      break;
    }
  }

  if (codec) {
    switch (codec) {
      case 'av1':
      case 'h265':
        encoding = { ...encoding };
        encoding.maxBitrate = encoding.maxBitrate * 0.7;
        break;
      case 'vp9':
        encoding = { ...encoding };
        encoding.maxBitrate = encoding.maxBitrate * 0.85;
        break;
      default:
        break;
    }
  }

  return encoding;
}

function defaultSimulcastLayers(
  isScreenShare: boolean,
  original: VideoPreset,
): VideoPreset[] {
  if (isScreenShare) {
    return computeDefaultScreenShareSimulcastPresets(original);
  }
  const { width, height } = original;
  const aspect = width > height ? width / height : height / width;
  if (Math.abs(aspect - 16.0 / 9) < Math.abs(aspect - 4.0 / 3)) {
    return defaultSimulcastPresets169;
  }
  return defaultSimulcastPresets43;
}

function sortPresets(presets: VideoPreset[] | undefined): VideoPreset[] | undefined {
  if (!presets) return undefined;
  return presets.sort((a, b) => {
    const { encoding: aEnc } = a;
    const { encoding: bEnc } = b;
    if (aEnc.maxBitrate > bEnc.maxBitrate) return 1;
    if (aEnc.maxBitrate < bEnc.maxBitrate) return -1;
    if (aEnc.maxBitrate === bEnc.maxBitrate && aEnc.maxFramerate && bEnc.maxFramerate) {
      return aEnc.maxFramerate > bEnc.maxFramerate ? 1 : -1;
    }
    return 0;
  });
}

function encodingsFromPresets(
  width: number,
  height: number,
  presets: VideoPreset[],
  sourceFramerate?: number,
): RTCRtpEncodingParameters[] {
  const encodings: RTCRtpEncodingParameters[] = [];
  presets.forEach((preset, idx) => {
    if (idx >= videoRids.length) return;
    const size = Math.min(width, height);
    const rid = videoRids[idx];

    const encoding: RTCRtpEncodingParameters = {
      rid,
      scaleResolutionDownBy: Math.max(1, size / Math.min(preset.width, preset.height)),
      maxBitrate: preset.encoding.maxBitrate,
    };
    const maxFramerate =
      sourceFramerate && preset.encoding.maxFramerate
        ? Math.min(sourceFramerate, preset.encoding.maxFramerate)
        : preset.encoding.maxFramerate;
    if (maxFramerate) {
      encoding.maxFramerate = maxFramerate;
    }
    if (preset.encoding.priority && idx === 0) {
      encoding.priority = preset.encoding.priority;
      encoding.networkPriority = preset.encoding.priority;
    }
    encodings.push(encoding);
  });
  return encodings;
}

/**
 * Compute video encodings for publishing based on the current track source,
 * dimensions, and publish options. Handles simulcast layers and SVC modes.
 */
export function computeVideoEncodings(
  isScreenShare: boolean,
  width?: number,
  height?: number,
  options?: TrackPublishOptions,
): RTCRtpEncodingParameters[] {
  let videoEncoding: VideoEncoding | undefined = isScreenShare
    ? options?.screenShareEncoding
    : options?.videoEncoding;

  const useSimulcast = options?.simulcast;
  const scalabilityMode = options?.scalabilityMode;
  const videoCodec = options?.videoCodec;

  if ((!videoEncoding && !useSimulcast && !scalabilityMode) || !width || !height) {
    return [{}];
  }

  if (!videoEncoding) {
    videoEncoding = determineAppropriateEncoding(isScreenShare, width, height, videoCodec);
    log.debug('using video encoding', videoEncoding);
  }

  const sourceFramerate = videoEncoding.maxFramerate;

  const original = new VideoPreset(
    width,
    height,
    videoEncoding.maxBitrate,
    videoEncoding.maxFramerate,
    videoEncoding.priority,
  );

  if (scalabilityMode && isSVCCodec(videoCodec)) {
    const sm = parseScalabilityMode(scalabilityMode);
    const encodings: RTCRtpEncodingParameters[] = [];

    if (sm.spatial > 3) {
      throw new Error(`unsupported scalabilityMode: ${scalabilityMode}`);
    }

    encodings.push({
      maxBitrate: videoEncoding.maxBitrate,
      maxFramerate: original.encoding.maxFramerate,
      /* @ts-ignore */
      scalabilityMode,
    });

    if (original.encoding.priority) {
      encodings[0].priority = original.encoding.priority;
      encodings[0].networkPriority = original.encoding.priority;
    }

    log.debug('using svc encoding', { encodings });
    return encodings;
  }

  if (!useSimulcast) {
    return [videoEncoding];
  }

  let presets: VideoPreset[] = [];
  if (isScreenShare) {
    presets =
      sortPresets(options?.screenShareSimulcastLayers) ??
      defaultSimulcastLayers(isScreenShare, original);
  } else {
    presets =
      sortPresets(options?.videoSimulcastLayers) ??
      defaultSimulcastLayers(isScreenShare, original);
  }

  let midPreset: VideoPreset | undefined;
  if (presets.length > 0) {
    const lowPreset = presets[0];
    if (presets.length > 1) {
      [, midPreset] = presets;
    }

    const size = Math.max(width, height);
    if (size >= 960 && midPreset) {
      return encodingsFromPresets(width, height, [lowPreset, midPreset, original], sourceFramerate);
    }
    if (size >= 480) {
      return encodingsFromPresets(width, height, [lowPreset, original], sourceFramerate);
    }
  }
  return encodingsFromPresets(width, height, [original]);
}

function parseScalabilityMode(mode: string): { spatial: number; temporal: number } {
  const results = mode.match(/^L(\d)T(\d)/);
  if (!results) {
    throw new Error(`invalid scalability mode: ${mode}`);
  }
  return {
    spatial: parseInt(results[1]),
    temporal: parseInt(results[2]),
  };
}

/**
 * Returns the default degradation preference for a video track based on its
 * source and resolution constraints.
 */
export function getDefaultDegradationPreference(
  source: TrackSource,
  constraints?: MediaTrackConstraints,
): RTCDegradationPreference {
  if (source === TrackSource.ScreenShare) {
    return 'maintain-resolution';
  }
  if (constraints?.height) {
    const h =
      typeof constraints.height === 'object'
        ? (constraints.height as ConstrainULongRange).ideal ??
          (constraints.height as ConstrainULongRange).max ??
          0
        : constraints.height;
    if (typeof h === 'number' && h >= 1080) {
      return 'maintain-resolution';
    }
  }
  return 'balanced';
}
