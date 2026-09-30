// Per-conversation recovery flags with a deadline, held in this process only:
// "do not try the summary again before T" (a failed compaction,
// context-compact.ts) and "the provider rejected this thread for length"
// (context-overflow.ts).
//
// Neither is state an answer depends on — both only steer the next turn's
// compaction — so a restart or a second server instance simply retries, which
// is the right behaviour for a flag that records a provider outage.
//
// Bounded on both axes so a conversation that fails once and is never opened
// again cannot hold an entry forever: expired entries are swept on every
// write, and the oldest entry is evicted once `max` conversations are held.
const MAX_FLAGS = 2_000;

export interface ConvFlags {
  /** Raise the flag for this conversation. It expires ttlMs from now. */
  set(convId: string, now?: number): void;
  /** True while the flag is up. Reading an expired flag drops it. */
  has(convId: string, now?: number): boolean;
  clear(convId: string): void;
  /** Held entries, expired ones included until the next sweep. Tests only. */
  readonly size: number;
}

export function convFlags(ttlMs: number, max = MAX_FLAGS): ConvFlags {
  const until = new Map<string, number>();

  const sweep = (now: number) => {
    for (const [id, deadline] of until) if (now >= deadline) until.delete(id);
  };

  return {
    set(convId, now = Date.now()) {
      // Delete first so a re-raised flag moves to the end: every entry of one
      // instance shares a ttl, so insertion order is expiry order, which is
      // what makes evicting the first key evict the oldest.
      until.delete(convId);
      sweep(now);
      while (until.size >= max) {
        const oldest = until.keys().next();
        if (oldest.done) break;
        until.delete(oldest.value);
      }
      until.set(convId, now + ttlMs);
    },

    has(convId, now = Date.now()) {
      const deadline = until.get(convId);
      if (deadline == null) return false;
      if (now >= deadline) {
        until.delete(convId);
        return false;
      }
      return true;
    },

    clear(convId) {
      until.delete(convId);
    },

    get size() {
      return until.size;
    },
  };
}
