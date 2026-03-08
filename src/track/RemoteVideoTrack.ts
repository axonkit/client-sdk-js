import { RemoteTrack } from './RemoteTrack';
import { TrackKind, TrackSource } from '../protocol/types';
import { TrackEvent } from '../events';
import type { AdaptiveStreamSettings } from './options';
import type { RPCClient } from '../signal/RPCClient';
import { getLogger } from '../utils/logger';

const log = getLogger('RemoteVideoTrack');
const DEBOUNCE_MS = 300;

/** @internal */
export interface ElementInfo {
  element: HTMLVideoElement;
  visible: boolean;
  width: number;
  height: number;
}

export class RemoteVideoTrack extends RemoteTrack {
  adaptiveStreamSettings?: AdaptiveStreamSettings;

  private rpc?: RPCClient;
  private elementInfos: ElementInfo[] = [];
  private intersectionObserver?: IntersectionObserver;
  private resizeObserver?: ResizeObserver;
  private visibilityBound?: () => void;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private pipElement?: HTMLVideoElement;

  constructor(
    source: TrackSource = TrackSource.Camera,
    mediaStreamTrack: MediaStreamTrack,
  ) {
    super(TrackKind.Video, source, mediaStreamTrack);
  }

  get isAdaptiveStream(): boolean {
    return this.adaptiveStreamSettings !== undefined;
  }

  /** @internal */
  setAdaptiveStream(rpc: RPCClient, settings: AdaptiveStreamSettings): void {
    this.rpc = rpc;
    this.adaptiveStreamSettings = settings;
    this.setupAdaptiveObservers();
  }

  override attach(element?: HTMLMediaElement): HTMLMediaElement {
    const el = super.attach(element) as HTMLVideoElement;
    if (this.isAdaptiveStream) {
      this.observeElement(el);
    }
    return el;
  }

  override detach(element?: HTMLMediaElement): HTMLMediaElement[] {
    const detached = super.detach(element);
    for (const el of detached) {
      this.unobserveElement(el as HTMLVideoElement);
    }
    return detached;
  }

  /** Enter Picture-in-Picture on the first attached video element. */
  async requestPictureInPicture(): Promise<PictureInPictureWindow | undefined> {
    if (!document.pictureInPictureEnabled) return undefined;
    const el = this.getFirstVideoElement();
    if (!el) return undefined;
    try {
      const pipWindow = await el.requestPictureInPicture();
      this.pipElement = el;
      el.addEventListener('leavepictureinpicture', () => {
        this.pipElement = undefined;
      }, { once: true });
      return pipWindow;
    } catch (e) {
      log.warn('Failed to enter PiP', e);
      return undefined;
    }
  }

  override stop(): void {
    this.cleanupAdaptive();
    super.stop();
  }

  // ---- Adaptive stream internals ----

  private setupAdaptiveObservers(): void {
    if (typeof window === 'undefined') return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const info = this.elementInfos.find((i) => i.element === entry.target);
          if (info) {
            const wasVisible = info.visible;
            info.visible = entry.isIntersecting;
            if (wasVisible !== info.visible) {
              this.emit(TrackEvent.VisibilityChanged, info.visible, this);
              this.handleVisibilityUpdate();
            }
          }
        }
      },
      { threshold: 0 },
    );

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const info = this.elementInfos.find((i) => i.element === entry.target);
        if (info) {
          const { width, height } = entry.contentRect;
          if (Math.abs(width - info.width) >= 10 || Math.abs(height - info.height) >= 10) {
            info.width = width;
            info.height = height;
            this.emit(TrackEvent.VideoDimensionsChanged, { width, height }, this);
            this.debouncedUpdateLayers();
          }
        }
      }
    });

    const pauseInBg = this.adaptiveStreamSettings?.pauseVideoInBackground ?? true;
    if (pauseInBg && typeof document !== 'undefined') {
      this.visibilityBound = () => this.handlePageVisibilityChange();
      document.addEventListener('visibilitychange', this.visibilityBound);
    }
  }

  private observeElement(el: HTMLVideoElement): void {
    if (this.elementInfos.some((i) => i.element === el)) return;
    const info: ElementInfo = {
      element: el,
      visible: true,
      width: el.clientWidth,
      height: el.clientHeight,
    };
    this.elementInfos.push(info);
    this.intersectionObserver?.observe(el);
    this.resizeObserver?.observe(el);
  }

  private unobserveElement(el: HTMLVideoElement): void {
    const idx = this.elementInfos.findIndex((i) => i.element === el);
    if (idx >= 0) {
      this.elementInfos.splice(idx, 1);
    }
    this.intersectionObserver?.unobserve(el);
    this.resizeObserver?.unobserve(el);
  }

  private handleVisibilityUpdate(): void {
    if (!this.rpc || !this.subscriptionSid) return;
    const anyVisible = this.elementInfos.some((i) => i.visible) || this.pipElement !== undefined;
    if (anyVisible) {
      this.rpc.request('subscription.resume', { subscriptionSid: this.subscriptionSid }).catch((e) => {
        log.warn('Failed to resume subscription', e);
      });
    } else {
      this.rpc.request('subscription.pause', { subscriptionSid: this.subscriptionSid }).catch((e) => {
        log.warn('Failed to pause subscription', e);
      });
    }
  }

  private handlePageVisibilityChange(): void {
    if (!this.rpc || !this.subscriptionSid) return;
    if (document.hidden) {
      if (this.pipElement) return;
      this.rpc.request('subscription.pause', { subscriptionSid: this.subscriptionSid }).catch((e) => {
        log.warn('Failed to pause subscription on visibility change', e);
      });
    } else {
      const anyVisible = this.elementInfos.some((i) => i.visible);
      if (anyVisible) {
        this.rpc.request('subscription.resume', { subscriptionSid: this.subscriptionSid }).catch((e) => {
          log.warn('Failed to resume subscription on visibility change', e);
        });
      }
    }
  }

  private debouncedUpdateLayers(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.updatePreferredLayers();
    }, DEBOUNCE_MS);
  }

  private updatePreferredLayers(): void {
    if (!this.rpc || !this.subscriptionSid) return;

    let maxWidth = 0;
    let maxHeight = 0;
    for (const info of this.elementInfos) {
      if (info.visible) {
        maxWidth = Math.max(maxWidth, info.width);
        maxHeight = Math.max(maxHeight, info.height);
      }
    }
    if (maxWidth === 0 && maxHeight === 0) return;

    const density = this.getPixelDensity();
    const spatialLayer = this.calculateSpatialLayer(maxWidth * density, maxHeight * density);
    this.rpc
      .request('subscription.setPreferredLayers', {
        subscriptionSid: this.subscriptionSid,
        spatialLayer,
      })
      .catch((e) => {
        log.warn('Failed to set preferred layers', e);
      });
  }

  private getPixelDensity(): number {
    const setting = this.adaptiveStreamSettings?.pixelDensity;
    if (setting === 'screen') {
      return typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    }
    return setting ?? 1;
  }

  private calculateSpatialLayer(effectiveWidth: number, effectiveHeight: number): number {
    const pixels = effectiveWidth * effectiveHeight;
    if (pixels < 200 * 150) return 0;
    if (pixels < 640 * 360) return 1;
    return 2;
  }

  private cleanupAdaptive(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.intersectionObserver?.disconnect();
    this.resizeObserver?.disconnect();
    if (this.visibilityBound && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityBound);
    }
    this.elementInfos = [];
  }

  private getFirstVideoElement(): HTMLVideoElement | undefined {
    for (const el of this.attachedElements) {
      if (el instanceof HTMLVideoElement) return el;
    }
    return undefined;
  }
}
