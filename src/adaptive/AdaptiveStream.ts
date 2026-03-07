import { RPCClient } from '../signal/RPCClient';
import type { AdaptiveStreamSettings } from '../track/options';
import { getLogger } from '../utils/logger';

const log = getLogger('AdaptiveStream');

const DEBOUNCE_MS = 300;

interface ObservedElement {
  element: HTMLVideoElement;
  subscriptionSid: string;
  isPaused: boolean;
  intersectionObserver: IntersectionObserver;
  resizeObserver: ResizeObserver;
  debounceTimer?: ReturnType<typeof setTimeout>;
  lastWidth: number;
  lastHeight: number;
}

export class AdaptiveStream {
  private rpc: RPCClient;
  private observed = new Map<string, ObservedElement>();
  private pixelDensity: number;
  private pauseVideoInBackground: boolean;
  private handleVisibilityBound: () => void;

  constructor(rpc: RPCClient, settings?: AdaptiveStreamSettings) {
    this.rpc = rpc;
    this.pauseVideoInBackground = settings?.pauseVideoInBackground ?? true;

    if (settings?.pixelDensity === 'screen') {
      this.pixelDensity = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    } else {
      this.pixelDensity = settings?.pixelDensity
        ?? (typeof window !== 'undefined' && window.devicePixelRatio >= 3 ? 2 : 1);
    }

    this.handleVisibilityBound = this.handleVisibilityChange.bind(this);
    if (this.pauseVideoInBackground && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityBound);
    }
  }

  observe(element: HTMLVideoElement, subscriptionSid: string): void {
    if (this.observed.has(subscriptionSid)) return;

    const entry: ObservedElement = {
      element,
      subscriptionSid,
      isPaused: false,
      intersectionObserver: null!,
      resizeObserver: null!,
      lastWidth: element.clientWidth,
      lastHeight: element.clientHeight,
    };

    entry.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          this.handleIntersection(subscriptionSid, e.isIntersecting);
        }
      },
      { threshold: 0 },
    );

    entry.resizeObserver = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        this.handleResize(subscriptionSid, width, height);
      }
    });

    entry.intersectionObserver.observe(element);
    entry.resizeObserver.observe(element);
    this.observed.set(subscriptionSid, entry);

    log.debug(`Observing element for subscription ${subscriptionSid}`);
  }

  unobserve(subscriptionSid: string): void {
    const entry = this.observed.get(subscriptionSid);
    if (!entry) return;

    entry.intersectionObserver.disconnect();
    entry.resizeObserver.disconnect();
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    this.observed.delete(subscriptionSid);

    log.debug(`Stopped observing subscription ${subscriptionSid}`);
  }

  clear(): void {
    for (const [sid] of this.observed) {
      this.unobserve(sid);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityBound);
    }
  }

  private handleVisibilityChange(): void {
    if (!this.pauseVideoInBackground) return;
    const hidden = document.hidden;
    for (const [sid, entry] of this.observed) {
      if (hidden && !entry.isPaused) {
        entry.isPaused = true;
        this.rpc.request('subscription.pause', { subscriptionSid: sid }).catch((err) => {
          log.warn(`Failed to pause subscription ${sid}`, err);
        });
      } else if (!hidden && entry.isPaused) {
        entry.isPaused = false;
        this.rpc.request('subscription.resume', { subscriptionSid: sid }).catch((err) => {
          log.warn(`Failed to resume subscription ${sid}`, err);
        });
      }
    }
  }

  private handleIntersection(subscriptionSid: string, isVisible: boolean): void {
    const entry = this.observed.get(subscriptionSid);
    if (!entry) return;

    if (isVisible && entry.isPaused) {
      entry.isPaused = false;
      this.rpc.request('subscription.resume', { subscriptionSid }).catch((err) => {
        log.warn(`Failed to resume subscription ${subscriptionSid}`, err);
      });
      log.debug(`Resumed subscription ${subscriptionSid} (visible)`);
    } else if (!isVisible && !entry.isPaused) {
      entry.isPaused = true;
      this.rpc.request('subscription.pause', { subscriptionSid }).catch((err) => {
        log.warn(`Failed to pause subscription ${subscriptionSid}`, err);
      });
      log.debug(`Paused subscription ${subscriptionSid} (not visible)`);
    }
  }

  private handleResize(subscriptionSid: string, width: number, height: number): void {
    const entry = this.observed.get(subscriptionSid);
    if (!entry) return;

    // Skip if size hasn't changed meaningfully
    if (Math.abs(width - entry.lastWidth) < 10 && Math.abs(height - entry.lastHeight) < 10) {
      return;
    }

    // Debounce
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      entry.lastWidth = width;
      entry.lastHeight = height;

      const spatialLayer = this.calculateSpatialLayer(width, height);
      this.rpc
        .request('subscription.setPreferredLayers', { subscriptionSid, spatialLayer })
        .catch((err) => {
          log.warn(`Failed to set preferred layers for ${subscriptionSid}`, err);
        });

      log.debug(`Set preferred spatial layer=${spatialLayer} for ${subscriptionSid} (${width}x${height})`);
    }, DEBOUNCE_MS);
  }

  private calculateSpatialLayer(width: number, height: number): number {
    const effectiveWidth = width * this.pixelDensity;
    const effectiveHeight = height * this.pixelDensity;
    const pixels = effectiveWidth * effectiveHeight;
    if (pixels < 200 * 150) return 0;
    if (pixels < 640 * 360) return 1;
    return 2;
  }
}
