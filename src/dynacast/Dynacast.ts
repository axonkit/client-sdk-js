import { VideoQuality } from '../protocol/types';
import type { LocalVideoTrack } from '../track/LocalVideoTrack';
import { getLogger } from '../utils/logger';

const log = getLogger('Dynacast');

const QUALITY_RID_MAP: Record<number, string> = {
  [VideoQuality.LOW]: 'q',
  [VideoQuality.MEDIUM]: 'h',
  [VideoQuality.HIGH]: 'f',
};

export interface SubscribedQualityUpdate {
  quality: VideoQuality;
  enabled: boolean;
}

export class Dynacast {
  private trackMap = new Map<string, LocalVideoTrack>();

  registerTrack(trackSid: string, track: LocalVideoTrack): void {
    this.trackMap.set(trackSid, track);
  }

  unregisterTrack(trackSid: string): void {
    this.trackMap.delete(trackSid);
  }

  async handleSubscribedQualityChanged(
    trackSid: string,
    subscribedQualities: SubscribedQualityUpdate[],
  ): Promise<void> {
    const track = this.trackMap.get(trackSid);
    if (!track?.sender) return;

    const params = track.sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return;

    for (const sq of subscribedQualities) {
      const rid = QUALITY_RID_MAP[sq.quality];
      const encoding = params.encodings.find((e) => e.rid === rid);
      if (encoding) {
        encoding.active = sq.enabled;
        log.debug(`Dynacast: rid=${rid} active=${sq.enabled} for track ${trackSid}`);
      }
    }

    await track.sender.setParameters(params);
  }

  async handleSubscriptionStatusChanged(
    trackSid: string,
    hasSubscribers: boolean,
  ): Promise<void> {
    const track = this.trackMap.get(trackSid);
    if (!track?.sender) return;

    if (hasSubscribers) {
      if (track.mediaStreamTrack) {
        await track.sender.replaceTrack(track.mediaStreamTrack);
        log.debug(`Dynacast: resumed track ${trackSid}`);
      }
    } else {
      await track.sender.replaceTrack(null);
      log.debug(`Dynacast: paused track ${trackSid} (no subscribers)`);
    }
  }

  clear(): void {
    this.trackMap.clear();
  }
}
