// Bounded in-memory cache over a Map. Db-free on purpose: tests mock `db.ts`
// process-wide, and this must stay real under that mock.
//
// Eviction drops the oldest entry in Map order while `size > max`, after the
// insert, so a re-set of a present key never evicts. Plain mode is FIFO: `get`
// leaves order alone and `set` of a present key keeps its position. `lru` mode
// re-inserts on every hit, so the head is the least recently read. With `ttlMs`
// an entry is stale once `now - at >= ttlMs`; a stale entry reads as absent and
// is dropped by that read. `has` and `size` never expire or reorder anything.

interface CacheOptions {
  /** Capacity; a getter is re-read on every insert so a config change applies to the next one. */
  max: number | (() => number);
  ttlMs?: number;
  /** A hit moves the entry to the most-recently-used end. */
  lru?: boolean;
}

interface Cache<V> {
  get(key: string): V | undefined;
  /** `at` stamps the entry for TTL purposes (default: now), for callers that stamp before an await. */
  set(key: string, value: V, at?: number): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

export function createCache<V>(opts: CacheOptions): Cache<V> {
  const entries = new Map<string, { v: V; at: number }>();
  const cap = typeof opts.max === "function" ? opts.max : () => opts.max as number;
  return {
    get(key) {
      const e = entries.get(key);
      if (!e) return undefined;
      if (opts.ttlMs !== undefined && Date.now() - e.at >= opts.ttlMs) {
        entries.delete(key);
        return undefined;
      }
      if (opts.lru) {
        entries.delete(key);
        entries.set(key, e);
      }
      return e.v;
    },
    set(key, value, at = Date.now()) {
      entries.set(key, { v: value, at });
      const max = cap();
      while (entries.size > max) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    has: (key) => entries.has(key),
    delete: (key) => void entries.delete(key),
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}
