// Bounded concurrency primitives. Db-free on purpose: tests mock `db.ts`
// process-wide, and these must stay real under that mock.

export interface Semaphore {
  /** Resolves once a slot is held; every acquire must be paired with a release. */
  acquire(): Promise<void>;
  release(): void;
}

/** FIFO counting semaphore. `limit` may be a getter so a config change applies to the next acquire. */
export function createSemaphore(limit: number | (() => number)): Semaphore {
  const cap = typeof limit === "function" ? limit : () => limit;
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    acquire() {
      if (active < cap()) {
        active++;
        return Promise.resolve();
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
    release() {
      active--;
      const next = waiters.shift();
      if (next) {
        active++;
        next();
      }
    },
  };
}

/**
 * Runs `fn` over `items` with at most `limit` in flight and returns the results
 * in input order. A rejection from `fn` rejects the whole call, as `Promise.all` does.
 */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
