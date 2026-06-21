/**
 * Lightweight in-process TTL cache — a drop-in replacement for the three
 * Redis GET/SET/DEL patterns used in auth middleware and billing service.
 *
 * Why not a library: our needs are trivial (3 tiny caches, <100 keys each).
 * A plain Map with an expiry timestamp has zero dependencies, no async I/O,
 * and is correct for Node.js's single-threaded execution model.
 *
 * Expiry is checked lazily on get(), so stale entries don't linger in memory
 * indefinitely. For caches this small this is fine; add a periodic sweep only
 * if cache size ever becomes a concern.
 */
export class TtlCache<K, V> {
  private readonly store = new Map<K, { value: V; exp: number }>();

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.exp) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlSeconds: number): void {
    this.store.set(key, { value, exp: Date.now() + ttlSeconds * 1_000 });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (String(key).startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
