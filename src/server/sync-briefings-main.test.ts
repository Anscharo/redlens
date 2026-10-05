// sync-briefings.ts entry point: the advisory lock around a run, the shutdown
// of the pool, and the real dependency bundle.
import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { makeFakeSql } from "./briefings-sql-fake.ts";
import type { BriefingDeps } from "./briefings-deps.ts";

const baseExports = { ...(await import("./db.ts")) };
const fake = makeFakeSql();
mock.module("./db.ts", () => ({ ...baseExports, sql: fake.sql }));

const { main } = await import("./sync-briefings.ts");

afterAll(() => void mock.module("./db.ts", () => baseExports));
beforeEach(() => fake.reset());

const quiet = <T>(fn: () => Promise<T>) => {
  const [log, warn] = [console.log, console.warn];
  const out = { logs: [] as string[], warns: [] as string[] };
  console.log = (...a) => void out.logs.push(a.join(" "));
  console.warn = (...a) => void out.warns.push(a.join(" "));
  return fn().then(
    () => ((console.log = log), (console.warn = warn), out),
    (e) => ((console.log = log), (console.warn = warn), Promise.reject(e)),
  );
};

/** Deps whose run reports back through `ran`. runMigrations is the first thing runBriefings calls. */
function fakeDeps(ran: string[], fail = false): BriefingDeps {
  return {
    runMigrations: async () => {
      ran.push("run");
      if (fail) throw new Error("migration failed");
      return [];
    },
    store: { loadSnapshot: async () => ({ atlasSha: null, docs: [] }) } as unknown as BriefingDeps["store"],
  } as unknown as BriefingDeps;
}

const lockCalls = () => fake.calls.filter((c) => c.text.includes("advisory"));

describe("main", () => {
  it("takes the advisory lock, runs, unlocks, releases and ends the pool", async () => {
    fake.script("pg_try_advisory_lock", [{ pg_try_advisory_lock: true }]);
    const ran: string[] = [];
    const out = await quiet(() => main(fakeDeps(ran)));
    expect(ran).toEqual(["run"]);
    expect(lockCalls().map((c) => c.text.match(/pg_\w+/)![0])).toEqual(["pg_try_advisory_lock", "pg_advisory_unlock"]);
    expect(lockCalls()[0]!.params).toEqual(lockCalls()[1]!.params);
    expect(fake.state.releases).toBe(1);
    expect(fake.state.ended).toBe(true);
    expect(out.warns.join()).toContain("atlas_doc_meta is empty");
  });

  it("skips the run when another process holds the lock", async () => {
    fake.script("pg_try_advisory_lock", [{ pg_try_advisory_lock: false }]);
    const ran: string[] = [];
    const out = await quiet(() => main(fakeDeps(ran)));
    expect(ran).toEqual([]);
    expect(out.logs.join()).toContain("another run holds the lock");
    expect(lockCalls()).toHaveLength(1); // no unlock for a lock it never took
    expect(fake.state.releases).toBe(1);
    expect(fake.state.ended).toBe(true);
  });

  it("runs unlocked when no connection can be reserved", async () => {
    fake.state.reserveError = new Error("pool exhausted");
    const ran: string[] = [];
    const out = await quiet(() => main(fakeDeps(ran)));
    expect(ran).toEqual(["run"]);
    expect(out.warns.join()).toContain("advisory lock unavailable (pool exhausted)");
    expect(fake.state.releases).toBe(0);
  });

  it("still releases and ends the pool when the run throws, and survives a dead unlock", async () => {
    fake.script("pg_try_advisory_lock", [{ pg_try_advisory_lock: true }]);
    fake.script("pg_advisory_unlock", new Error("connection closed"));
    await expect(quiet(() => main(fakeDeps([], true)))).rejects.toThrow("migration failed");
    expect(fake.state.releases).toBe(1);
    expect(fake.state.ended).toBe(true);
  });
});
