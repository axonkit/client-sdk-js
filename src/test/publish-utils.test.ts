import { describe, it, expect } from 'vitest';
import {
  isSVCCodec,
  determineAppropriateEncoding,
  getDefaultDegradationPreference,
} from '../track/publishUtils';
import { TrackSource } from '../protocol/types';

// ---------------------------------------------------------------------------
// isSVCCodec
// ---------------------------------------------------------------------------

describe('isSVCCodec', () => {
  it('returns true for av1', () => {
    expect(isSVCCodec('av1')).toBe(true);
  });

  it('returns true for vp9', () => {
    expect(isSVCCodec('vp9')).toBe(true);
  });

  it('returns false for vp8', () => {
    expect(isSVCCodec('vp8')).toBe(false);
  });

  it('returns false for h264', () => {
    expect(isSVCCodec('h264')).toBe(false);
  });

  it('returns false for h265', () => {
    expect(isSVCCodec('h265')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isSVCCodec(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSVCCodec('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// determineAppropriateEncoding
// ---------------------------------------------------------------------------

describe('determineAppropriateEncoding', () => {
  it('returns an encoding with maxBitrate for camera video', () => {
    const enc = determineAppropriateEncoding(false, 1280, 720);
    expect(enc.maxBitrate).toBeGreaterThan(0);
  });

  it('returns an encoding for screen share', () => {
    const enc = determineAppropriateEncoding(true, 1920, 1080);
    expect(enc.maxBitrate).toBeGreaterThan(0);
  });

  it('reduces bitrate for av1 codec', () => {
    const base = determineAppropriateEncoding(false, 1280, 720);
    const av1 = determineAppropriateEncoding(false, 1280, 720, 'av1');
    expect(av1.maxBitrate).toBeLessThan(base.maxBitrate);
    expect(av1.maxBitrate).toBeCloseTo(base.maxBitrate * 0.7, -2);
  });

  it('reduces bitrate for vp9 codec', () => {
    const base = determineAppropriateEncoding(false, 1280, 720);
    const vp9 = determineAppropriateEncoding(false, 1280, 720, 'vp9');
    expect(vp9.maxBitrate).toBeLessThan(base.maxBitrate);
    expect(vp9.maxBitrate).toBeCloseTo(base.maxBitrate * 0.85, -2);
  });

  it('reduces bitrate for h265 codec', () => {
    const base = determineAppropriateEncoding(false, 1280, 720);
    const h265 = determineAppropriateEncoding(false, 1280, 720, 'h265');
    expect(h265.maxBitrate).toBeCloseTo(base.maxBitrate * 0.7, -2);
  });

  it('does not reduce bitrate for vp8 or h264', () => {
    const base = determineAppropriateEncoding(false, 1280, 720);
    const vp8 = determineAppropriateEncoding(false, 1280, 720, 'vp8');
    const h264 = determineAppropriateEncoding(false, 1280, 720, 'h264');
    expect(vp8.maxBitrate).toBe(base.maxBitrate);
    expect(h264.maxBitrate).toBe(base.maxBitrate);
  });

  it('returns higher bitrate for larger resolutions', () => {
    const small = determineAppropriateEncoding(false, 320, 180);
    const large = determineAppropriateEncoding(false, 1920, 1080);
    expect(large.maxBitrate).toBeGreaterThan(small.maxBitrate);
  });

  it('handles portrait (height > width) resolution', () => {
    const enc = determineAppropriateEncoding(false, 720, 1280);
    expect(enc.maxBitrate).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getDefaultDegradationPreference
// ---------------------------------------------------------------------------

describe('getDefaultDegradationPreference', () => {
  it('returns maintain-resolution for screen share', () => {
    expect(getDefaultDegradationPreference(TrackSource.ScreenShare)).toBe('maintain-resolution');
  });

  it('returns maintain-resolution for >= 1080p constraints', () => {
    expect(
      getDefaultDegradationPreference(TrackSource.Camera, { height: 1080 } as MediaTrackConstraints),
    ).toBe('maintain-resolution');
  });

  it('returns balanced for < 1080p constraints', () => {
    expect(
      getDefaultDegradationPreference(TrackSource.Camera, { height: 720 } as MediaTrackConstraints),
    ).toBe('balanced');
  });

  it('returns balanced when no constraints provided', () => {
    expect(getDefaultDegradationPreference(TrackSource.Camera)).toBe('balanced');
  });

  it('returns balanced for microphone source', () => {
    expect(getDefaultDegradationPreference(TrackSource.Microphone)).toBe('balanced');
  });

  it('handles constrained height as { exact }', () => {
    expect(
      getDefaultDegradationPreference(TrackSource.Camera, {
        height: { exact: 1080 },
      } as MediaTrackConstraints),
    ).toBe('maintain-resolution');
  });

  it('handles constrained height as { ideal }', () => {
    expect(
      getDefaultDegradationPreference(TrackSource.Camera, {
        height: { ideal: 2160 },
      } as MediaTrackConstraints),
    ).toBe('maintain-resolution');
  });
});
