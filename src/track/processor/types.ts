import type { TrackKind } from '../../protocol/types';

/**
 * Options provided to a track processor during initialization.
 *
 * @experimental
 */
export interface ProcessorOptions<T extends TrackKind = TrackKind> {
  kind: T;
  track: MediaStreamTrack;
  element?: HTMLMediaElement;
  audioContext?: AudioContext;
}

/**
 * A track processor transforms a `MediaStreamTrack` before publishing.
 *
 * Implementors must provide at least `init`, `restart`, and `destroy`.
 * The SDK calls these methods at the appropriate lifecycle moments.
 *
 * After `init` (and `restart`), the processor MUST set `processedTrack`
 * to the transformed output track. The SDK will publish this track instead
 * of the original.
 *
 * @experimental
 */
export interface TrackProcessor<T extends TrackKind = TrackKind> {
  /** Human-readable processor name (for logging/debugging). */
  name: string;

  /**
   * Initialize the processor with the given options. After this call,
   * `processedTrack` must be set.
   */
  init: (opts: ProcessorOptions<T>) => Promise<void>;

  /**
   * Restart the processor (e.g. when the source track changes). The
   * implementation should release old resources and re-initialize with the
   * new options.
   */
  restart: (opts: ProcessorOptions<T>) => Promise<void>;

  /**
   * Destroy the processor and release all resources. After calling this,
   * `processedTrack` should be `undefined`.
   */
  destroy: () => Promise<void>;

  /**
   * The transformed output track. Must be set after `init` / `restart`.
   * The SDK publishes this track instead of the original source.
   */
  processedTrack?: MediaStreamTrack;
}
