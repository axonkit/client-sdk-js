import { describe, it, expect } from 'vitest';
import { MediaDeviceFailure } from '../utils/deviceFailure';

describe('MediaDeviceFailure.getFailure', () => {
  it('returns undefined for falsy input', () => {
    expect(MediaDeviceFailure.getFailure(null)).toBeUndefined();
    expect(MediaDeviceFailure.getFailure(undefined)).toBeUndefined();
    expect(MediaDeviceFailure.getFailure(0)).toBeUndefined();
    expect(MediaDeviceFailure.getFailure('')).toBeUndefined();
  });

  describe('PermissionDenied', () => {
    it('detects NotAllowedError', () => {
      const err = new DOMException('User denied', 'NotAllowedError');
      expect(MediaDeviceFailure.getFailure(err)).toBe('PermissionDenied');
    });

    it('detects PermissionDeniedError', () => {
      expect(MediaDeviceFailure.getFailure({ name: 'PermissionDeniedError' })).toBe(
        'PermissionDenied',
      );
    });

    it('detects via message heuristic', () => {
      expect(MediaDeviceFailure.getFailure({ name: 'Other', message: 'Permission denied' })).toBe(
        'PermissionDenied',
      );
    });
  });

  describe('NotFound', () => {
    it('detects NotFoundError', () => {
      const err = new DOMException('No device', 'NotFoundError');
      expect(MediaDeviceFailure.getFailure(err)).toBe('NotFound');
    });

    it('detects DevicesNotFoundError', () => {
      expect(MediaDeviceFailure.getFailure({ name: 'DevicesNotFoundError' })).toBe('NotFound');
    });

    it('detects via message heuristic', () => {
      expect(MediaDeviceFailure.getFailure({ name: 'X', message: 'device not found' })).toBe(
        'NotFound',
      );
    });
  });

  describe('DeviceInUse', () => {
    it('detects NotReadableError', () => {
      expect(MediaDeviceFailure.getFailure({ name: 'NotReadableError' })).toBe('DeviceInUse');
    });

    it('detects TrackStartError', () => {
      expect(MediaDeviceFailure.getFailure({ name: 'TrackStartError' })).toBe('DeviceInUse');
    });

    it('detects AbortError', () => {
      expect(MediaDeviceFailure.getFailure({ name: 'AbortError' })).toBe('DeviceInUse');
    });

    it('detects via "in use" message heuristic', () => {
      expect(
        MediaDeviceFailure.getFailure({ name: 'Other', message: 'device in use by another app' }),
      ).toBe('DeviceInUse');
    });

    it('detects via "could not start" message heuristic', () => {
      expect(
        MediaDeviceFailure.getFailure({ name: 'Other', message: 'Could not start video source' }),
      ).toBe('DeviceInUse');
    });
  });

  it('returns undefined for unrecognized errors', () => {
    expect(
      MediaDeviceFailure.getFailure({ name: 'SyntaxError', message: 'bad constraints' }),
    ).toBeUndefined();
    expect(
      MediaDeviceFailure.getFailure(new Error('something unexpected')),
    ).toBeUndefined();
  });
});
