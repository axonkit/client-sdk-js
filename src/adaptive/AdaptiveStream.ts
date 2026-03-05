import { RPCClient } from '../signal/RPCClient';
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

  constructor(rpc: RPCClient) {
    this.rpc = rpc;
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
          this.handleVisibilityChange(subscriptionSid, e.isIntersecting);
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
  }

  private handleVisibilityChange(subscriptionSid: string, isVisible: boolean): void {
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
    const pixels = width * height;
    // Rough heuristic: < 150p → layer 0, < 360p → layer 1, else → layer 2
    if (pixels < 200 * 150) return 0;
    if (pixels < 640 * 360) return 1;
    return 2;
  }
}
