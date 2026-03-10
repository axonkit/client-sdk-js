import type { LocalTrack } from '../track/LocalTrack';
import type { Track } from '../track/Track';

/**
 * Details about the current browser.
 */
export interface BrowserDetails {
  name: string;
  version: string;
  os?: string;
  osVersion?: string;
  supportsInsertableStreams: boolean;
  supportsTransceiver: boolean;
}

/**
 * Options for creating an audio analyser.
 */
export interface AudioAnalyserOptions {
  /**
   * FFT size for the analyser node. Must be a power of 2 between 32 and 32768.
   * @defaultValue 2048
   */
  fftSize?: number;

  /**
   * Smoothing constant for the analyser node.
   * @defaultValue 0.8
   */
  smoothingTimeConstant?: number;

  /**
   * If `true`, uses float frequency data; otherwise uses byte frequency data.
   * @defaultValue false
   */
  useFloat?: boolean;
}

export function isFireFox(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.userAgent.includes('Firefox/');
}

/** Check whether the current browser supports the minimum WebRTC features. */
export function isBrowserSupported(): boolean {
  if (typeof RTCPeerConnection === 'undefined') return false;
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.mediaDevices === 'undefined') return false;
  if (typeof navigator.mediaDevices.getUserMedia === 'undefined') return false;
  return true;
}

/** Whether the browser supports adaptive stream (IntersectionObserver + ResizeObserver). */
export function supportsAdaptiveStream(): boolean {
  return typeof IntersectionObserver !== 'undefined' && typeof ResizeObserver !== 'undefined';
}

/** Whether the browser is likely to support dynacast (simulcast encoding control). */
export function supportsDynacast(): boolean {
  if (typeof RTCRtpSender === 'undefined') return false;
  return (
    typeof RTCRtpSender.prototype.getParameters === 'function' &&
    typeof RTCRtpSender.prototype.setParameters === 'function'
  );
}

/** Check for AV1 support via `RTCRtpSender.getCapabilities`. */
export function supportsAV1(): boolean {
  return hasCodecSupport('video/AV1');
}

/** Check for VP9 support via `RTCRtpSender.getCapabilities`. */
export function supportsVP9(): boolean {
  return hasCodecSupport('video/VP9');
}

/** Whether the browser supports `HTMLMediaElement.setSinkId` for audio output device selection. */
export function supportsAudioOutputSelection(): boolean {
  if (typeof HTMLMediaElement === 'undefined') return false;
  return typeof (HTMLMediaElement.prototype as any).setSinkId === 'function';
}

/** Detect the current browser name and version. */
export function getBrowser(): BrowserDetails {
  if (typeof navigator === 'undefined') {
    return {
      name: 'unknown',
      version: '',
      supportsInsertableStreams: false,
      supportsTransceiver: false,
    };
  }

  const ua = navigator.userAgent;
  let name = 'unknown';
  let version = '';

  if (ua.includes('Firefox/')) {
    name = 'Firefox';
    version = ua.split('Firefox/')[1]?.split(' ')[0] ?? '';
  } else if (ua.includes('Edg/')) {
    name = 'Edge';
    version = ua.split('Edg/')[1]?.split(' ')[0] ?? '';
  } else if (ua.includes('Chrome/')) {
    name = 'Chrome';
    version = ua.split('Chrome/')[1]?.split(' ')[0] ?? '';
  } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
    name = 'Safari';
    version = ua.split('Version/')[1]?.split(' ')[0] ?? '';
  }

  const supportsInsertableStreams =
    typeof (RTCRtpSender.prototype as any).createEncodedStreams === 'function' ||
    typeof (window as any).RTCRtpScriptTransform !== 'undefined';

  const supportsTransceiver = typeof RTCPeerConnection.prototype.addTransceiver === 'function';

  return { name, version, supportsInsertableStreams, supportsTransceiver };
}

/**
 * Create a silent audio `MediaStreamTrack`. Useful as a placeholder when
 * a real track isn't available.
 */
export function getEmptyAudioStreamTrack(): MediaStreamTrack {
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const dst = ctx.createMediaStreamDestination();
  oscillator.connect(dst);
  oscillator.start();
  const track = dst.stream.getAudioTracks()[0];
  oscillator.stop();
  ctx.close();
  return track;
}

/**
 * Create a black video `MediaStreamTrack`. Useful as a placeholder when
 * a real track isn't available.
 */
export function getEmptyVideoStreamTrack(width = 2, height = 2): MediaStreamTrack {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);
  }
  const stream = canvas.captureStream(0);
  return stream.getVideoTracks()[0];
}

/**
 * Attempt to determine facing mode from a device label string.
 * Returns `'user'` for front cameras and `'environment'` for back cameras.
 */
export function facingModeFromDeviceLabel(label: string): string | undefined {
  const lower = label.toLowerCase();
  if (lower.includes('front') || lower.includes('user') || lower.includes('facetime')) {
    return 'user';
  }
  if (lower.includes('back') || lower.includes('rear') || lower.includes('environment')) {
    return 'environment';
  }
  return undefined;
}

/**
 * Detect facing mode from an existing {@link LocalTrack} by inspecting
 * track settings and device label.
 */
export function facingModeFromLocalTrack(track: LocalTrack): string | undefined {
  const settings = track.mediaStreamTrack?.getSettings();
  if (settings?.facingMode) {
    return settings.facingMode;
  }
  const label = track.mediaStreamTrack?.label;
  if (label) {
    return facingModeFromDeviceLabel(label);
  }
  return undefined;
}

/**
 * Create a Web Audio `AnalyserNode` connected to a track's audio.
 * Returns the analyser and a cleanup function.
 */
export function createAudioAnalyser(
  track: Track,
  options?: AudioAnalyserOptions,
): { analyser: AnalyserNode; cleanup: () => void } {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
  const analyser = ctx.createAnalyser();

  analyser.fftSize = options?.fftSize ?? 2048;
  analyser.smoothingTimeConstant = options?.smoothingTimeConstant ?? 0.8;

  source.connect(analyser);

  return {
    analyser,
    cleanup: () => {
      source.disconnect();
      analyser.disconnect();
      ctx.close();
    },
  };
}

// --- Internal helpers ---

function hasCodecSupport(mimeType: string): boolean {
  if (typeof RTCRtpSender === 'undefined') return false;
  if (typeof RTCRtpSender.getCapabilities !== 'function') return false;
  const caps = RTCRtpSender.getCapabilities('video');
  if (!caps) return false;
  return caps.codecs.some((c) => c.mimeType.toLowerCase() === mimeType.toLowerCase());
}
