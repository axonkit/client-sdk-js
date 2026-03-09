// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class TypedEventEmitter<T extends {} = {}> {
  private listeners = new Map<string | symbol, Set<(...args: any[]) => void>>();

  on<K extends keyof T>(event: K, listener: T[K]): this {
    const key = event as string | symbol;
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener as (...args: any[]) => void);
    return this;
  }

  once<K extends keyof T>(event: K, listener: T[K]): this {
    const wrapped = (...args: any[]) => {
      this.off(event, wrapped as any);
      (listener as (...a: any[]) => void)(...args);
    };
    return this.on(event, wrapped as any);
  }

  off<K extends keyof T>(event: K, listener: T[K]): this {
    const key = event as string | symbol;
    this.listeners.get(key)?.delete(listener as (...args: any[]) => void);
    return this;
  }

  emit<K extends keyof T>(
    event: K,
    ...args: T[K] extends (...a: infer P) => any ? P : any[]
  ): boolean {
    const key = event as string | symbol;
    const set = this.listeners.get(key);
    if (!set || set.size === 0) return false;
    for (const fn of set) {
      fn(...args);
    }
    return true;
  }

  removeAllListeners(event?: keyof T): this {
    if (event) {
      this.listeners.delete(event as string | symbol);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  listenerCount(event: keyof T): number {
    return this.listeners.get(event as string | symbol)?.size ?? 0;
  }
}
