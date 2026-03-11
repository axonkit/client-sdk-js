import { describe, it, expect } from 'vitest';
import {
  VideoPreset,
  VideoPresets,
  VideoPresets43,
  ScreenSharePresets,
  AudioPresets,
  audioCodecs,
  videoCodecs,
  defaultVideoCaptureOptions,
  defaultAudioCaptureOptions,
  defaultVideoEncoding,
  defaultScreenShareEncoding,
} from '../track/options';

// ---------------------------------------------------------------------------
// VideoPreset constructor
// ---------------------------------------------------------------------------

describe('VideoPreset', () => {
  describe('positional constructor', () => {
    it('creates a preset with width, height, maxBitrate', () => {
      const p = new VideoPreset(640, 360, 450_000);
      expect(p.width).toBe(640);
      expect(p.height).toBe(360);
      expect(p.encoding.maxBitrate).toBe(450_000);
      expect(p.encoding.maxFramerate).toBeUndefined();
    });

    it('accepts optional maxFramerate and priority', () => {
      const p = new VideoPreset(1280, 720, 1_700_000, 30, 'high');
      expect(p.encoding.maxFramerate).toBe(30);
      expect(p.encoding.priority).toBe('high');
    });

    it('computes aspectRatio from width/height', () => {
      const p = new VideoPreset(1920, 1080, 3_000_000);
      expect(p.aspectRatio).toBeCloseTo(1920 / 1080);
    });
  });

  describe('options object constructor', () => {
    it('creates a preset from an options object', () => {
      const p = new VideoPreset({
        width: 640,
        height: 480,
        maxBitrate: 500_000,
        maxFramerate: 20,
        priority: 'low',
      });
      expect(p.width).toBe(640);
      expect(p.height).toBe(480);
      expect(p.encoding.maxBitrate).toBe(500_000);
      expect(p.encoding.maxFramerate).toBe(20);
      expect(p.encoding.priority).toBe('low');
    });

    it('preserves aspectRatio from options', () => {
      const p = new VideoPreset({
        width: 640,
        height: 480,
        aspectRatio: 4 / 3,
        maxBitrate: 500_000,
      });
      expect(p.aspectRatio).toBeCloseTo(4 / 3);
    });
  });

  describe('resolution getter', () => {
    it('returns a VideoResolution', () => {
      const p = new VideoPreset(1280, 720, 1_700_000, 30);
      const res = p.resolution;
      expect(res.width).toBe(1280);
      expect(res.height).toBe(720);
      expect(res.frameRate).toBe(30);
      expect(res.aspectRatio).toBeCloseTo(1280 / 720);
    });
  });

  it('throws for invalid positional args (missing maxBitrate)', () => {
    expect(() => new VideoPreset(640, undefined as any, undefined as any)).toThrow(
      /Unsupported options/,
    );
  });
});

// ---------------------------------------------------------------------------
// Preset collections
// ---------------------------------------------------------------------------

describe('VideoPresets (16:9)', () => {
  it('contains expected presets', () => {
    expect(VideoPresets.h90).toBeDefined();
    expect(VideoPresets.h180).toBeDefined();
    expect(VideoPresets.h360).toBeDefined();
    expect(VideoPresets.h720).toBeDefined();
    expect(VideoPresets.h1080).toBeDefined();
    expect(VideoPresets.h2160).toBeDefined();
  });

  it('presets have increasing resolution and bitrate', () => {
    const ordered = [
      VideoPresets.h90,
      VideoPresets.h180,
      VideoPresets.h360,
      VideoPresets.h720,
      VideoPresets.h1080,
      VideoPresets.h2160,
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].width).toBeGreaterThan(ordered[i - 1].width);
      expect(ordered[i].encoding.maxBitrate).toBeGreaterThan(ordered[i - 1].encoding.maxBitrate);
    }
  });
});

describe('VideoPresets43 (4:3)', () => {
  it('contains expected presets', () => {
    expect(VideoPresets43.h120).toBeDefined();
    expect(VideoPresets43.h360).toBeDefined();
    expect(VideoPresets43.h720).toBeDefined();
  });

  it('presets have increasing bitrate', () => {
    const ordered = [
      VideoPresets43.h120,
      VideoPresets43.h180,
      VideoPresets43.h360,
      VideoPresets43.h720,
      VideoPresets43.h1080,
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].encoding.maxBitrate).toBeGreaterThan(ordered[i - 1].encoding.maxBitrate);
    }
  });
});

describe('ScreenSharePresets', () => {
  it('contains expected presets', () => {
    expect(ScreenSharePresets.h720fps5).toBeDefined();
    expect(ScreenSharePresets.h1080fps30).toBeDefined();
    expect(ScreenSharePresets.original).toBeDefined();
  });

  it('all presets have medium priority', () => {
    for (const preset of Object.values(ScreenSharePresets)) {
      expect(preset.encoding.priority).toBe('medium');
    }
  });
});

// ---------------------------------------------------------------------------
// Audio presets
// ---------------------------------------------------------------------------

describe('AudioPresets', () => {
  it('has increasing bitrate tiers', () => {
    expect(AudioPresets.telephone.maxBitrate).toBeLessThan(AudioPresets.speech.maxBitrate);
    expect(AudioPresets.speech.maxBitrate).toBeLessThan(AudioPresets.music.maxBitrate);
    expect(AudioPresets.music.maxBitrate).toBeLessThan(AudioPresets.musicStereo.maxBitrate);
    expect(AudioPresets.musicStereo.maxBitrate).toBeLessThan(
      AudioPresets.musicHighQuality.maxBitrate,
    );
    expect(AudioPresets.musicHighQuality.maxBitrate).toBeLessThan(
      AudioPresets.musicHighQualityStereo.maxBitrate,
    );
  });
});

// ---------------------------------------------------------------------------
// Codec lists
// ---------------------------------------------------------------------------

describe('codec lists', () => {
  it('audioCodecs contains opus and red', () => {
    expect(audioCodecs).toContain('opus');
    expect(audioCodecs).toContain('red');
  });

  it('videoCodecs contains all expected entries', () => {
    expect(videoCodecs).toContain('vp8');
    expect(videoCodecs).toContain('h264');
    expect(videoCodecs).toContain('vp9');
    expect(videoCodecs).toContain('av1');
    expect(videoCodecs).toContain('h265');
  });
});

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

describe('default capture/encoding options', () => {
  it('defaultVideoCaptureOptions is 720p @ 30fps', () => {
    expect(defaultVideoCaptureOptions.resolution?.width).toBe(1280);
    expect(defaultVideoCaptureOptions.resolution?.height).toBe(720);
    expect(defaultVideoCaptureOptions.frameRate).toBe(30);
  });

  it('defaultAudioCaptureOptions has processing enabled', () => {
    expect(defaultAudioCaptureOptions.echoCancellation).toBe(true);
    expect(defaultAudioCaptureOptions.noiseSuppression).toBe(true);
    expect(defaultAudioCaptureOptions.autoGainControl).toBe(true);
  });

  it('defaultVideoEncoding is 1.7Mbps @ 30fps', () => {
    expect(defaultVideoEncoding.maxBitrate).toBe(1_700_000);
    expect(defaultVideoEncoding.maxFramerate).toBe(30);
  });

  it('defaultScreenShareEncoding is 3Mbps @ 30fps', () => {
    expect(defaultScreenShareEncoding.maxBitrate).toBe(3_000_000);
    expect(defaultScreenShareEncoding.maxFramerate).toBe(30);
  });
});
