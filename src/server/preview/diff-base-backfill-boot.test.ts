import { test, expect } from "bun:test";
import { config } from "../config.ts";
import { runBackfillPass, startPreviewDiffBaseBackfill, type BackfillBootDeps } from "./diff-base-backfill-boot.ts";

const EMPTY = { filled: 0, skipped: 0, failed: 0 };

// A reserved connection that answers the advisory-lock queries and records them.
function fakeReserved(lockFree = true) {
  const seen: string[] = [];
  let released = 0;
  const conn = Object.assign(
    async (strings: TemplateStringsArray) => {
      const q = strings.join("?");
      seen.push(q);
      return q.includes("pg_try_advisory_lock") ? [{ pg_try_advisory_lock: lockFree }] : [];
    },
    { release: () => void released++ },
  );
  return { conn, seen, released: () => released };
}

function deps(over: Partial<BackfillBootDeps>): BackfillBootDeps & { scheduled: number[] } {
  const scheduled: number[] = [];
  return {
    reserve: async () => fakeReserved().conn,
    backfill: async () => EMPTY,
    retryMs: 1000,
    schedule: (_fn, ms) => void scheduled.push(ms),
    ...over,
    scheduled,
  };
}

async function withToken<T>(fn: () => Promise<T>): Promise<T> {
  const orig = config.githubToken;
  config.githubToken = "svc-token";
  try {
    return await fn();
  } finally {
    config.githubToken = orig;
  }
}

test("returns before taking a lock when no token is configured", () => {
  const orig = config.githubToken;
  config.githubToken = "";
  try {
    expect(startPreviewDiffBaseBackfill()).toBeUndefined();
  } finally {
    config.githubToken = orig;
  }
});

test("a refused connection resolves, warns once and schedules a retry", async () => {
  await withToken(async () => {
    const refused = new Error("Failed to connect");
    const d = deps({ reserve: async () => Promise.reject(refused) });
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m: string) => void warns.push(m);
    try {
      await startPreviewDiffBaseBackfill(d);
    } finally {
      console.warn = origWarn;
    }
    expect(d.scheduled).toEqual([1000]);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("database unavailable (Failed to connect)");
  });
});

test("a retry that still finds no database stays quiet and reschedules", async () => {
  await withToken(async () => {
    const pending: Array<() => void> = [];
    let calls = 0;
    const d = deps({
      reserve: async () => {
        calls++;
        if (calls < 3) throw new Error("Failed to connect");
        return fakeReserved().conn;
      },
      schedule: (fn) => void pending.push(fn),
    });
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m: string) => void warns.push(m);
    try {
      await startPreviewDiffBaseBackfill(d);
      pending.shift()?.();
      await Bun.sleep(0);
      pending.shift()?.();
      await Bun.sleep(0);
    } finally {
      console.warn = origWarn;
    }
    expect(calls).toBe(3);
    expect(warns).toHaveLength(1);
    expect(pending).toHaveLength(0);
  });
});

test("a pass takes the lock, runs the backfill, unlocks and releases", async () => {
  const r = fakeReserved();
  let ran = 0;
  const err = await runBackfillPass(deps({ reserve: async () => r.conn, backfill: async () => (ran++, EMPTY) }));
  expect(err).toBeNull();
  expect(ran).toBe(1);
  expect(r.seen[0]).toContain("pg_try_advisory_lock");
  expect(r.seen.at(-1)).toContain("pg_advisory_unlock");
  expect(r.released()).toBe(1);
});

test("a pass skips the backfill when another replica holds the lock, and unlocks nothing", async () => {
  const r = fakeReserved(false);
  let ran = 0;
  const err = await runBackfillPass(deps({ reserve: async () => r.conn, backfill: async () => (ran++, EMPTY) }));
  expect(err).toBeNull();
  expect(ran).toBe(0);
  expect(r.seen.some((q) => q.includes("pg_advisory_unlock"))).toBe(false);
  expect(r.released()).toBe(1);
});

test("a backfill that throws reports why by error name, unlocks and releases", async () => {
  const r = fakeReserved();
  const err = await runBackfillPass(deps({ reserve: async () => r.conn, backfill: async () => Promise.reject(new TypeError("https://x/?token=secret")) }));
  expect(err).toBe("failed (TypeError)");
  expect(r.seen.at(-1)).toContain("pg_advisory_unlock");
  expect(r.released()).toBe(1);
});

test("a release that throws does not reject the pass", async () => {
  const r = fakeReserved();
  const conn = Object.assign(r.conn, { release: () => { throw new Error("socket closed"); } });
  expect(await runBackfillPass(deps({ reserve: async () => conn }))).toBeNull();
});

test("a failed backfill (a DB reachable but not migrated yet) is retried, then runs", async () => {
  await withToken(async () => {
    const pending: Array<() => void> = [];
    let calls = 0;
    const d = deps({
      backfill: async () => {
        calls++;
        if (calls === 1) throw new Error('relation "previews" does not exist');
        return EMPTY;
      },
      schedule: (fn) => void pending.push(fn),
    });
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m: string) => void warns.push(m);
    try {
      await startPreviewDiffBaseBackfill(d);
      expect(pending).toHaveLength(1);
      pending.shift()?.();
      await Bun.sleep(0);
    } finally {
      console.warn = origWarn;
    }
    expect(calls).toBe(2);
    expect(pending).toHaveLength(0);
    expect(warns).toEqual(["[preview] diff-base backfill: failed (Error); retrying every 0m"]);
  });
});
