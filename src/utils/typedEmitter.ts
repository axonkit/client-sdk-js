import { EventEmitter } from 'events';

/**
 * A typed wrapper over Node's `EventEmitter`.
 *
 * Extends `EventEmitter` with `declare` overrides so that `emit`, `on`,
 * `off`, etc. are type-safe without introducing circular-reference issues
 * that arise when using `typed-emitter` directly in `extends` clauses
 * whose event maps reference the class itself.
 *
 * Runtime behaviour is 100% `EventEmitter`; this class adds zero runtime
 * code.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class TypedEmitter<
  T extends Record<string, (...args: any[]) => void> = {},
> extends EventEmitter {
  declare emit: <E extends string | number>(
    event: E,
    ...args: E extends keyof T ? Parameters<T[E]> : any[]
  ) => boolean;

  declare on: <E extends string | number>(
    event: E,
    listener: E extends keyof T ? T[E] : (...args: any[]) => void,
  ) => this;

  declare once: <E extends string | number>(
    event: E,
    listener: E extends keyof T ? T[E] : (...args: any[]) => void,
  ) => this;

  declare off: <E extends string | number>(
    event: E,
    listener: E extends keyof T ? T[E] : (...args: any[]) => void,
  ) => this;

  declare addListener: <E extends string | number>(
    event: E,
    listener: E extends keyof T ? T[E] : (...args: any[]) => void,
  ) => this;

  declare removeListener: <E extends string | number>(
    event: E,
    listener: E extends keyof T ? T[E] : (...args: any[]) => void,
  ) => this;

  declare removeAllListeners: (event?: string | number) => this;

  declare listeners: <E extends string | number>(
    event: E,
  ) => E extends keyof T ? T[E][] : ((...args: any[]) => void)[];

  declare rawListeners: <E extends string | number>(
    event: E,
  ) => E extends keyof T ? T[E][] : ((...args: any[]) => void)[];

  declare listenerCount: (event: string | number) => number;
}
