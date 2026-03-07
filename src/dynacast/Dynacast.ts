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
    if (!track) return;
    
    await track.setDynacastQuality(subscribedQualities);
  }

  async handleSubscriptionStatusChanged(
    trackSid: string,
    hasSubscribers: boolean,
  ): Promise<void> {
    const track = this.trackMap.get(trackSid);
    if (!track) return;
    
    await track.setSubscriptionStatus(hasSubscribers);
    if (hasSubscribers) {
      log.debug(`Dynacast: resumed track ${trackSid}`);
    } else {
      log.debug(`Dynacast: paused track ${trackSid} (no subscribers)`);
    }
  }

  clear(): void {
    this.trackMap.clear();
  }
}
