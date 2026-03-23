import { describe, it, expect } from 'vitest';
import { BackupCodecPolicy, isBackupVideoCodec } from '../track/options';
import type {
  TrackPublishRequest,
  PublishBackupTrackRequest,
  PublishBackupTrackResponse,
  SubscribedCodecInfo,
  TrackSubscribedQualityChangedNotification,
} from '../protocol/types';
import { VideoQuality } from '../protocol/types';
import { resolveBackupCodec } from '../participant/LocalParticipant';
import type { TrackPublishOptions } from '../track/options';

// ---------------------------------------------------------------------------
// BackupCodecPolicy enum
// ---------------------------------------------------------------------------

describe('BackupCodecPolicy', () => {
  it('has correct numeric values', () => {
    expect(BackupCodecPolicy.PREFER_REGRESSION).toBe(0);
    expect(BackupCodecPolicy.SIMULCAST).toBe(1);
    expect(BackupCodecPolicy.REGRESSION).toBe(2);
  });

  it('is usable as a number in comparisons', () => {
    const policy: BackupCodecPolicy = BackupCodecPolicy.SIMULCAST;
    expect(policy === 1).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isBackupVideoCodec
// ---------------------------------------------------------------------------

describe('isBackupVideoCodec', () => {
  it('returns true for vp8', () => {
    expect(isBackupVideoCodec('vp8')).toBe(true);
  });

  it('returns true for h264', () => {
    expect(isBackupVideoCodec('h264')).toBe(true);
  });

  it('returns false for vp9', () => {
    expect(isBackupVideoCodec('vp9')).toBe(false);
  });

  it('returns false for av1', () => {
    expect(isBackupVideoCodec('av1')).toBe(false);
  });

  it('returns false for h265', () => {
    expect(isBackupVideoCodec('h265')).toBe(false);
  });

  it('returns false for unknown codec', () => {
    expect(isBackupVideoCodec('unknown')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isBackupVideoCodec('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveBackupCodec
// ---------------------------------------------------------------------------

describe('resolveBackupCodec', () => {
  it('returns undefined when backupCodec is false', () => {
    const opts: TrackPublishOptions = { backupCodec: false };
    expect(resolveBackupCodec(opts)).toBeUndefined();
  });

  it('returns undefined when backupCodec is not set', () => {
    const opts: TrackPublishOptions = {};
    expect(resolveBackupCodec(opts)).toBeUndefined();
  });

  it('returns vp8 when backupCodec=true and primary is SVC codec (vp9)', () => {
    const opts: TrackPublishOptions = { videoCodec: 'vp9', backupCodec: true };
    expect(resolveBackupCodec(opts)).toBe('vp8');
  });

  it('returns vp8 when backupCodec=true and primary is av1', () => {
    const opts: TrackPublishOptions = { videoCodec: 'av1', backupCodec: true };
    expect(resolveBackupCodec(opts)).toBe('vp8');
  });

  it('returns vp8 when backupCodec=true and primary is h265', () => {
    const opts: TrackPublishOptions = { videoCodec: 'h265', backupCodec: true };
    expect(resolveBackupCodec(opts)).toBe('vp8');
  });

  it('returns undefined when backupCodec=true and primary is already a backup codec (vp8)', () => {
    const opts: TrackPublishOptions = { videoCodec: 'vp8', backupCodec: true };
    expect(resolveBackupCodec(opts)).toBeUndefined();
  });

  it('returns undefined when backupCodec=true and primary is h264', () => {
    const opts: TrackPublishOptions = { videoCodec: 'h264', backupCodec: true };
    expect(resolveBackupCodec(opts)).toBeUndefined();
  });

  it('returns undefined when backupCodec=true and no videoCodec set', () => {
    const opts: TrackPublishOptions = { backupCodec: true };
    expect(resolveBackupCodec(opts)).toBeUndefined();
  });

  it('returns codec from object when different from primary', () => {
    const opts: TrackPublishOptions = {
      videoCodec: 'vp9',
      backupCodec: { codec: 'vp8' },
    };
    expect(resolveBackupCodec(opts)).toBe('vp8');
  });

  it('returns h264 from object when primary is av1', () => {
    const opts: TrackPublishOptions = {
      videoCodec: 'av1',
      backupCodec: { codec: 'h264' },
    };
    expect(resolveBackupCodec(opts)).toBe('h264');
  });

  it('returns undefined when backup codec object matches primary', () => {
    const opts: TrackPublishOptions = {
      videoCodec: 'vp8',
      backupCodec: { codec: 'vp8' },
    };
    expect(resolveBackupCodec(opts)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Protocol type: TrackPublishRequest — codec fields
// ---------------------------------------------------------------------------

describe('TrackPublishRequest codec fields', () => {
  it('supports videoCodec, backupCodec, and backupCodecPolicy', () => {
    const req: TrackPublishRequest = {
      clientTrackId: 'ct-1',
      name: 'camera',
      kind: 'video' as any,
      rtpParameters: {} as any,
      source: 'camera' as any,
      muted: false,
      videoCodec: 'vp9',
      backupCodec: 'vp8',
      backupCodecPolicy: BackupCodecPolicy.REGRESSION,
    };

    expect(req.videoCodec).toBe('vp9');
    expect(req.backupCodec).toBe('vp8');
    expect(req.backupCodecPolicy).toBe(2);
  });

  it('codec fields are optional', () => {
    const req: TrackPublishRequest = {
      clientTrackId: 'ct-2',
      name: 'mic',
      kind: 'audio' as any,
      rtpParameters: {} as any,
      source: 'microphone' as any,
      muted: false,
    };

    expect(req.videoCodec).toBeUndefined();
    expect(req.backupCodec).toBeUndefined();
    expect(req.backupCodecPolicy).toBeUndefined();
  });

  it('serializes correctly to JSON', () => {
    const req: TrackPublishRequest = {
      clientTrackId: 'ct-3',
      name: 'screen',
      kind: 'video' as any,
      rtpParameters: {} as any,
      source: 'screen_share' as any,
      muted: false,
      videoCodec: 'av1',
      backupCodec: 'h264',
      backupCodecPolicy: BackupCodecPolicy.PREFER_REGRESSION,
    };

    const json = JSON.parse(JSON.stringify(req));
    expect(json.videoCodec).toBe('av1');
    expect(json.backupCodec).toBe('h264');
    expect(json.backupCodecPolicy).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Protocol type: PublishBackupTrackRequest / Response
// ---------------------------------------------------------------------------

describe('PublishBackupTrackRequest/Response', () => {
  it('has required fields', () => {
    const req: PublishBackupTrackRequest = {
      trackSid: 'track-123',
      clientTrackId: 'ct-backup',
      rtpParameters: {} as any,
    };

    expect(req.trackSid).toBe('track-123');
    expect(req.clientTrackId).toBe('ct-backup');
  });

  it('response contains backupTrackSid', () => {
    const resp: PublishBackupTrackResponse = {
      backupTrackSid: 'backup-sid-abc',
    };

    expect(resp.backupTrackSid).toBe('backup-sid-abc');
  });

  it('round-trips through JSON', () => {
    const req: PublishBackupTrackRequest = {
      trackSid: 'track-456',
      clientTrackId: 'ct-bk2',
      rtpParameters: { codecs: [], headerExtensions: [], encodings: [], rtcp: {} } as any,
    };

    const decoded = JSON.parse(JSON.stringify(req)) as PublishBackupTrackRequest;
    expect(decoded.trackSid).toBe('track-456');
    expect(decoded.clientTrackId).toBe('ct-bk2');
  });
});

// ---------------------------------------------------------------------------
// Protocol type: SubscribedCodecInfo
// ---------------------------------------------------------------------------

describe('SubscribedCodecInfo', () => {
  it('has codec and qualities fields', () => {
    const info: SubscribedCodecInfo = {
      codec: 'vp9',
      qualities: [
        { quality: VideoQuality.LOW, enabled: true },
        { quality: VideoQuality.MEDIUM, enabled: true },
        { quality: VideoQuality.HIGH, enabled: false },
      ],
    };

    expect(info.codec).toBe('vp9');
    expect(info.qualities).toHaveLength(3);
    expect(info.qualities[2].enabled).toBe(false);
  });

  it('supports empty qualities array', () => {
    const info: SubscribedCodecInfo = {
      codec: 'vp8',
      qualities: [],
    };

    expect(info.qualities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Protocol type: TrackSubscribedQualityChangedNotification — extended
// ---------------------------------------------------------------------------

describe('TrackSubscribedQualityChangedNotification', () => {
  it('supports subscribedCodecs field', () => {
    const notif: TrackSubscribedQualityChangedNotification = {
      trackSid: 'track-sq',
      subscribedQualities: [
        { quality: VideoQuality.LOW, enabled: true },
        { quality: VideoQuality.MEDIUM, enabled: true },
        { quality: VideoQuality.HIGH, enabled: true },
      ],
      subscribedCodecs: [
        {
          codec: 'vp9',
          qualities: [
            { quality: VideoQuality.LOW, enabled: true },
            { quality: VideoQuality.MEDIUM, enabled: true },
            { quality: VideoQuality.HIGH, enabled: true },
          ],
        },
        {
          codec: 'vp8',
          qualities: [
            { quality: VideoQuality.LOW, enabled: true },
            { quality: VideoQuality.MEDIUM, enabled: true },
            { quality: VideoQuality.HIGH, enabled: true },
          ],
        },
      ],
    };

    expect(notif.subscribedCodecs).toHaveLength(2);
    expect(notif.subscribedCodecs![0].codec).toBe('vp9');
    expect(notif.subscribedCodecs![1].codec).toBe('vp8');
  });

  it('subscribedCodecs is optional for backward compat', () => {
    const notif: TrackSubscribedQualityChangedNotification = {
      trackSid: 'track-compat',
      subscribedQualities: [{ quality: VideoQuality.LOW, enabled: true }],
    };

    expect(notif.subscribedCodecs).toBeUndefined();
    expect(notif.subscribedQualities).toHaveLength(1);
  });

  it('round-trips through JSON with codecs', () => {
    const notif: TrackSubscribedQualityChangedNotification = {
      trackSid: 'track-rt',
      subscribedQualities: [],
      subscribedCodecs: [
        {
          codec: 'av1',
          qualities: [{ quality: VideoQuality.HIGH, enabled: false }],
        },
      ],
    };

    const decoded = JSON.parse(JSON.stringify(notif)) as TrackSubscribedQualityChangedNotification;
    expect(decoded.subscribedCodecs).toHaveLength(1);
    expect(decoded.subscribedCodecs![0].codec).toBe('av1');
    expect(decoded.subscribedCodecs![0].qualities[0].enabled).toBe(false);
  });

  it('round-trips through JSON without codecs', () => {
    const notif: TrackSubscribedQualityChangedNotification = {
      trackSid: 'track-rt-no',
      subscribedQualities: [{ quality: VideoQuality.MEDIUM, enabled: true }],
    };

    const decoded = JSON.parse(JSON.stringify(notif)) as TrackSubscribedQualityChangedNotification;
    expect(decoded.subscribedCodecs).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Codec-related helper: detect whether backup codec is needed
// ---------------------------------------------------------------------------

describe('backup codec detection logic', () => {
  it('detects when any quality is enabled in SubscribedCodecInfo', () => {
    const info: SubscribedCodecInfo = {
      codec: 'vp8',
      qualities: [
        { quality: VideoQuality.LOW, enabled: false },
        { quality: VideoQuality.MEDIUM, enabled: true },
        { quality: VideoQuality.HIGH, enabled: false },
      ],
    };

    const hasEnabled = info.qualities.some((q) => q.enabled);
    expect(hasEnabled).toBe(true);
  });

  it('detects when no quality is enabled in SubscribedCodecInfo', () => {
    const info: SubscribedCodecInfo = {
      codec: 'vp8',
      qualities: [
        { quality: VideoQuality.LOW, enabled: false },
        { quality: VideoQuality.MEDIUM, enabled: false },
        { quality: VideoQuality.HIGH, enabled: false },
      ],
    };

    const hasEnabled = info.qualities.some((q) => q.enabled);
    expect(hasEnabled).toBe(false);
  });

  it('correctly identifies backup codec in subscribedCodecs', () => {
    const subscribedCodecs: SubscribedCodecInfo[] = [
      {
        codec: 'vp9',
        qualities: [
          { quality: VideoQuality.LOW, enabled: true },
          { quality: VideoQuality.MEDIUM, enabled: true },
          { quality: VideoQuality.HIGH, enabled: true },
        ],
      },
      {
        codec: 'vp8',
        qualities: [
          { quality: VideoQuality.LOW, enabled: true },
          { quality: VideoQuality.MEDIUM, enabled: true },
          { quality: VideoQuality.HIGH, enabled: true },
        ],
      },
    ];

    const primaryCodec = 'vp9';
    for (const sc of subscribedCodecs) {
      const codecLower = sc.codec.toLowerCase();
      const hasEnabled = sc.qualities.some((q) => q.enabled);

      if (codecLower === primaryCodec) {
        expect(hasEnabled).toBe(true);
      } else if (hasEnabled && isBackupVideoCodec(codecLower)) {
        expect(codecLower).toBe('vp8');
      }
    }
  });

  it('handles regression reversal scenario (backup disabled)', () => {
    const subscribedCodecs: SubscribedCodecInfo[] = [
      {
        codec: 'vp9',
        qualities: [
          { quality: VideoQuality.LOW, enabled: true },
          { quality: VideoQuality.MEDIUM, enabled: true },
          { quality: VideoQuality.HIGH, enabled: true },
        ],
      },
      {
        codec: 'vp8',
        qualities: [
          { quality: VideoQuality.LOW, enabled: false },
          { quality: VideoQuality.MEDIUM, enabled: false },
          { quality: VideoQuality.HIGH, enabled: false },
        ],
      },
    ];

    const backupEntry = subscribedCodecs.find((sc) => sc.codec.toLowerCase() !== 'vp9');
    expect(backupEntry).toBeDefined();
    const backupEnabled = backupEntry!.qualities.some((q) => q.enabled);
    expect(backupEnabled).toBe(false);
  });
});
