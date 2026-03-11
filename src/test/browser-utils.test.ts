import { describe, it, expect } from 'vitest';
import { compareVersions, facingModeFromDeviceLabel, unwrapConstraint } from '../utils/browser';

// ---------------------------------------------------------------------------
// compareVersions
// ---------------------------------------------------------------------------

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns negative when a < b', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
  });

  it('returns positive when a > b', () => {
    expect(compareVersions('3.0.0', '2.0.0')).toBeGreaterThan(0);
  });

  it('compares minor versions', () => {
    expect(compareVersions('1.2.0', '1.3.0')).toBeLessThan(0);
    expect(compareVersions('1.3.0', '1.2.0')).toBeGreaterThan(0);
  });

  it('compares patch versions', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareVersions('1.2.5', '1.2.4')).toBeGreaterThan(0);
  });

  it('handles different length versions (missing parts treated as 0)', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
  });

  it('handles real-world Safari versions', () => {
    expect(compareVersions('17.4.1', '17.2')).toBeGreaterThan(0);
    expect(compareVersions('16.6', '17.0')).toBeLessThan(0);
    expect(compareVersions('18.4', '18.4')).toBe(0);
  });

  it('handles single digit versions', () => {
    expect(compareVersions('16', '17')).toBeLessThan(0);
    expect(compareVersions('17', '16')).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// facingModeFromDeviceLabel
// ---------------------------------------------------------------------------

describe('facingModeFromDeviceLabel', () => {
  it('returns "user" for front camera labels', () => {
    expect(facingModeFromDeviceLabel('Front Camera')).toBe('user');
    expect(facingModeFromDeviceLabel('User-facing camera')).toBe('user');
    expect(facingModeFromDeviceLabel('FaceTime HD Camera')).toBe('user');
  });

  it('returns "environment" for back camera labels', () => {
    expect(facingModeFromDeviceLabel('Back Camera')).toBe('environment');
    expect(facingModeFromDeviceLabel('Rear Camera')).toBe('environment');
    expect(facingModeFromDeviceLabel('environment camera 0')).toBe('environment');
  });

  it('returns undefined for unrecognized labels', () => {
    expect(facingModeFromDeviceLabel('HD Webcam')).toBeUndefined();
    expect(facingModeFromDeviceLabel('USB Camera')).toBeUndefined();
    expect(facingModeFromDeviceLabel('')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(facingModeFromDeviceLabel('FRONT CAMERA')).toBe('user');
    expect(facingModeFromDeviceLabel('BACK CAMERA')).toBe('environment');
  });
});

// ---------------------------------------------------------------------------
// unwrapConstraint
// ---------------------------------------------------------------------------

describe('unwrapConstraint', () => {
  it('returns string primitives as-is', () => {
    expect(unwrapConstraint('deviceId-123')).toBe('deviceId-123');
  });

  it('returns number primitives as-is', () => {
    expect(unwrapConstraint(30)).toBe(30);
  });

  it('unwraps { exact } objects', () => {
    expect(unwrapConstraint({ exact: 1920 })).toBe(1920);
  });

  it('unwraps { ideal } objects', () => {
    expect(unwrapConstraint({ ideal: 1080 })).toBe(1080);
  });

  it('prefers exact over ideal', () => {
    expect(unwrapConstraint({ exact: 720, ideal: 1080 })).toBe(720);
  });

  it('falls back to min when exact and ideal are missing', () => {
    expect(unwrapConstraint({ min: 480 })).toBe(480);
  });

  it('falls back to max when others are missing', () => {
    expect(unwrapConstraint({ max: 1080 })).toBe(1080);
  });

  it('returns 0 for empty object', () => {
    expect(unwrapConstraint({})).toBe(0);
  });

  it('returns first element of array', () => {
    expect(unwrapConstraint(['a', 'b', 'c'])).toBe('a');
  });
});
