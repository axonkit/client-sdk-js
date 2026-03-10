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

/** Whether we are running in a web (browser/Electron) environment as opposed to Node/React Native. */
export function isWeb(): boolean {
  return typeof document !== 'undefined';
}

/** Whether the current device is a mobile device. */
export function isMobile(): boolean {
  if (!isWeb()) return false;
  return (
    (navigator as any).userAgentData?.mobile ??
    /Tablet|iPad|Mobile|Android|BlackBerry/.test(navigator.userAgent)
  );
}

export function isFireFox(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.userAgent.includes('Firefox/');
}

export function isSafari(): boolean {
  return getBrowser()?.name === 'Safari';
}

export function isSafariBased(): boolean {
  const b = getBrowser();
  return b?.name === 'Safari' || b?.os === 'iOS';
}

export function isChromiumBased(): boolean {
  const b = getBrowser();
  return !!b && b.name === 'Chrome' && b.os !== 'iOS';
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
  if (!isWeb() || typeof HTMLMediaElement === 'undefined') return false;
  if (isSafariBased()) return false;
  return typeof (HTMLMediaElement.prototype as any).setSinkId === 'function';
}

/**
 * Compare two version strings (e.g. "17.4.1" vs "17.2").
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/** Detect the current browser name, version, and OS. */
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
  let os: string | undefined;
  let osVersion: string | undefined;

  // Detect OS
  if (/iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document)) {
    os = 'iOS';
    const match = ua.match(/OS (\d+[_.\d]*)/);
    if (match) osVersion = match[1].replace(/_/g, '.');
  } else if (ua.includes('Android')) {
    os = 'Android';
    const match = ua.match(/Android ([\d.]+)/);
    if (match) osVersion = match[1];
  } else if (ua.includes('Mac OS X')) {
    os = 'macOS';
    const match = ua.match(/Mac OS X ([\d_]+)/);
    if (match) osVersion = match[1].replace(/_/g, '.');
  } else if (ua.includes('Windows')) {
    os = 'Windows';
  } else if (ua.includes('Linux')) {
    os = 'Linux';
  }

  // Detect browser — order matters: Firefox first, then Chrome (which also
  // matches Edge/Opera), then Safari last.
  if (/firefox|fxios/i.test(ua)) {
    name = 'Firefox';
    const match = ua.match(/(?:Firefox|FxiOS)\/([\d.]+)/);
    version = match?.[1] ?? '';
  } else if (/chrom|crios|crmo/i.test(ua)) {
    name = 'Chrome';
    const match = ua.match(/(?:Chrome|CriOS|Chromium)\/([\d.]+)/);
    version = match?.[1] ?? '';
  } else if (/safari|applewebkit/i.test(ua)) {
    name = 'Safari';
    const match = ua.match(/Version\/([\d.]+)/);
    version = match?.[1] ?? '';
  }

  const supportsInsertableStreams =
    typeof (RTCRtpSender.prototype as any).createEncodedStreams === 'function' ||
    typeof (window as any).RTCRtpScriptTransform !== 'undefined';

  const supportsTransceiver = typeof RTCPeerConnection.prototype.addTransceiver === 'function';

  return { name, version, os, osVersion, supportsInsertableStreams, supportsTransceiver };
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
export function getEmptyVideoStreamTrack(width = 16, height = 16): MediaStreamTrack {
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
