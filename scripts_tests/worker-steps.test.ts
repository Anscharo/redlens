import { describe, expect, it, vi } from "vitest";
import {
  WORKER_STEPS,
  runTailSteps,
  runTickSteps,
  stepsIn,
  type WorkerContext,
  type WorkerStep,
} from "../scripts/lib/worker-steps/index.mjs";

function fakeCtx(over: Partial<WorkerContext> = {}) {
  const log = vi.fn<(line: string) => void>();
  const warn = vi.fn<(line: string) => void>();
  const runAsync = vi.fn<WorkerContext["runAsync"]>(async () => {});
  const ctx: WorkerContext = { db: {}, full: false, noFetch: false, inert: false, env: {}, runAsync, log, warn, ...over };
  return { ctx, log, warn, runAsync };
}

const tick = (id: string, run: WorkerStep["run"], extra: Partial<WorkerStep> = {}): WorkerStep => ({
  id,
  phase: "tick",
  label: `${id} step`,
  run,
  ...extra,
});

describe("worker step registry", () => {
  it("ids are unique and every step is in a known phase", () => {
    expect(new Set(WORKER_STEPS.map((s) => s.id)).size).toBe(WORKER_STEPS.length);
    for (const s of WORKER_STEPS) expect(["tick", "tail"]).toContain(s.phase);
  });

  it("runs the tick steps and tail lanes in their declared order", () => {
    expect(stepsIn(WORKER_STEPS, "tick").map((s) => s.id)).toEqual(["pr-env-copy", "pr-state", "chain-state", "balances", "pau", "forum"]);
    expect(stepsIn(WORKER_STEPS, "tail").map((s) => s.id)).toEqual(["embeddings", "history", "doc-versions", "briefings", "pau-rpc", "vote-evidence"]);
  });

  it("every tick step has a failure label; only network steps skip under --no-fetch", () => {
    for (const s of stepsIn(WORKER_STEPS, "tick")) expect(s.label, s.id).toBeTruthy();
    const skipping = stepsIn(WORKER_STEPS, "tick").filter((s) => s.skipWhenNoFetch).map((s) => s.id);
    expect(skipping).toEqual(["chain-state", "balances", "pau", "forum"]);
  });
});

describe("in a PR environment", () => {
  const prEnv = () => fakeCtx({ noFetch: true, inert: true, env: { GITHUB_TOKEN: "t" } });

  it("only the copy runs among the tick steps; every other one logs why it is skipped", async () => {
    const { ctx, log } = prEnv();
    const ran: string[] = [];
    const steps = stepsIn(WORKER_STEPS, "tick").map((s) => ({ ...s, run: async () => (ran.push(s.id), `${s.id} ran`) }));
    await runTickSteps(steps, ctx);
    expect(ran).toEqual(["pr-env-copy"]);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      "atlas-worker: pr-env-copy ran",
      "atlas-worker: pr-state sweep skipped (PR environment) — it calls the GitHub API",
      "atlas-worker: chain-state skipped (--no-fetch) — run `pnpm snap:chainstate` to populate it locally",
      "atlas-worker: balances skipped (--no-fetch) — POST /api/balances to populate them locally",
      "atlas-worker: pau skipped (--no-fetch) — it reads block explorers and RPCs",
      "atlas-worker: forum sync skipped (--no-fetch)",
    ]);
  });

  it("the copy is skipped silently everywhere else", async () => {
    for (const over of [{}, { noFetch: true }]) {
      const { ctx, log } = fakeCtx(over);
      const copy = vi.fn(async () => "copied");
      await runTickSteps([{ ...WORKER_STEPS.find((s) => s.id === "pr-env-copy")!, run: copy }], ctx);
      expect(copy).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    }
  });

  it("skips the OpenRouter lanes and tells the rest not to fetch", async () => {
    const { ctx, runAsync, log } = prEnv();
    await runTailSteps(WORKER_STEPS, ctx);
    const spawned = runAsync.mock.calls.map(([, args, opts]) => [args[0], opts?.env?.ATLAS_WORKER_NO_FETCH]);
    expect(spawned).toEqual([
      ["scripts/required/build-history.mjs", undefined],
      ["scripts/required/build-doc-versions.mjs", undefined],
      ["src/server/sync-pau-rpc.ts", "1"],
      ["src/server/sync-vote-evidence.ts", "1"],
    ]);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      "atlas-worker: embeddings skipped (PR environment) — they call OpenRouter",
      "atlas-worker: briefings skipped (PR environment) — the embed pass calls OpenRouter even under --no-fetch",
    ]);
  });
});

describe("runTickSteps", () => {
  it("logs each step's line, and a throwing step warns without stopping the rest", async () => {
    const { ctx, log, warn } = fakeCtx();
    const after = vi.fn(async () => "after ok");
    await runTickSteps([tick("a", async () => "a ok"), tick("b", async () => { throw new Error("boom"); }), tick("c", after)], ctx);
    expect(log.mock.calls.map((c) => c[0])).toEqual(["atlas-worker: a ok", "atlas-worker: after ok"]);
    expect(warn).toHaveBeenCalledWith("atlas-worker: b step skipped — boom");
    expect(after).toHaveBeenCalledOnce();
  });

  it("under --no-fetch logs the skip line instead of running a network step", async () => {
    const { ctx, log } = fakeCtx({ noFetch: true });
    const net = vi.fn(async () => "fetched");
    const local = vi.fn(async () => "local ok");
    await runTickSteps([tick("net", net, { skipWhenNoFetch: "net skipped (--no-fetch)" }), tick("local", local)], ctx);
    expect(net).not.toHaveBeenCalled();
    expect(local).toHaveBeenCalledOnce();
    expect(log.mock.calls.map((c) => c[0])).toEqual(["atlas-worker: net skipped (--no-fetch)", "atlas-worker: local ok"]);
  });

  it("ignores tail lanes", async () => {
    const { ctx } = fakeCtx();
    const lane = vi.fn(async () => {});
    await runTickSteps([{ id: "t", phase: "tail", run: lane }], ctx);
    expect(lane).not.toHaveBeenCalled();
  });
});

describe("runTailSteps", () => {
  it("starts every lane before any settles, and a failing lane only warns", async () => {
    const { ctx, warn } = fakeCtx();
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const lane = (id: string, fail = false): WorkerStep => ({
      id,
      phase: "tail",
      run: async () => {
        started.push(id);
        await gate;
        if (fail) throw new Error(`${id} exited 1`);
      },
    });
    const done = runTailSteps([lane("x"), lane("y", true), lane("z")], ctx);
    expect(started).toEqual(["x", "y", "z"]);
    release();
    await expect(done).resolves.toBeUndefined();
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["atlas-worker: y reconcile error: y exited 1"]);
  });

  it("turns a synchronous throw into a warning", async () => {
    const { ctx, warn } = fakeCtx();
    const bad = { id: "bad", phase: "tail", run: () => { throw new Error("sync"); } } as unknown as WorkerStep;
    await runTailSteps([bad], ctx);
    expect(warn).toHaveBeenCalledWith("atlas-worker: bad reconcile error: sync");
  });

  it("spawns the declared children with --full and the child env each lane needs", async () => {
    const { ctx, runAsync } = fakeCtx({ full: true, noFetch: true, env: { GITHUB_TOKEN: "t", KEEP: "1" } });
    await runTailSteps(WORKER_STEPS, ctx);
    const byScript = new Map(runAsync.mock.calls.map(([, args, opts]) => [args[0], { args, env: opts?.env }]));
    expect(byScript.get("src/server/sync-embeddings.ts")).toEqual({ args: ["src/server/sync-embeddings.ts"], env: undefined });
    expect(byScript.get("scripts/required/build-history.mjs")).toEqual({
      args: ["scripts/required/build-history.mjs", "--full"],
      env: { GITHUB_TOKEN: "t", KEEP: "1", GH_TOKEN: "t" },
    });
    expect(byScript.get("scripts/required/build-doc-versions.mjs")?.args).toEqual([
      "scripts/required/build-doc-versions.mjs",
      "--full",
    ]);
    expect(byScript.get("src/server/sync-briefings.ts")?.env).toEqual({ GITHUB_TOKEN: "t", KEEP: "1", ATLAS_WORKER_NO_FETCH: "1" });
    expect(byScript.get("src/server/sync-pau-rpc.ts")?.env).toEqual({ GITHUB_TOKEN: "t", KEEP: "1", ATLAS_WORKER_NO_FETCH: "1" });
    expect(byScript.get("src/server/sync-vote-evidence.ts")?.env).toEqual({ GITHUB_TOKEN: "t", KEEP: "1", ATLAS_WORKER_NO_FETCH: "1" });
  });

  it("without --full or --no-fetch passes neither flag", async () => {
    const { ctx, runAsync } = fakeCtx({ env: {} });
    await runTailSteps(WORKER_STEPS, ctx);
    for (const [, args, opts] of runAsync.mock.calls) {
      expect(args).not.toContain("--full");
      expect(opts?.env?.ATLAS_WORKER_NO_FETCH).toBeUndefined();
    }
    expect(runAsync.mock.calls.find(([, a]) => a[0] === "scripts/required/build-history.mjs")?.[2]?.env?.GH_TOKEN).toBe("");
  });
});
