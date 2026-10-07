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

type Entry<V> = { v: V; at: number };

class TtlCache<V> implements Cache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly opts: CacheOptions;
  private readonly cap: () => number;

  constructor(opts: CacheOptions) {
    this.opts = opts;
    const { max } = opts;
    this.cap = typeof max === "function" ? max : () => max;
  }

  get(key: string): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (this.opts.ttlMs !== undefined && Date.now() - e.at >= this.opts.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    if (this.opts.lru) {
      this.entries.delete(key);
      this.entries.set(key, e);
    }
    return e.v;
  }

  set(key: string, value: V, at = Date.now()): void {
    this.entries.set(key, { v: value, at });
    const max = this.cap();
    while (this.entries.size > max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export function createCache<V>(opts: CacheOptions): Cache<V> {
  return new TtlCache<V>(opts);
}
