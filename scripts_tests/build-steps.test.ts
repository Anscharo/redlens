// The atlas build chain is declared once in scripts/lib/build-steps.mjs and
// iterated by every JS orchestrator. Two sites can't import it — package.json's
// `build` script and the Dockerfile builder stage — so they are asserted here
// instead. A step added to one of them without a matching profile edit (or vice
// versa) fails this test rather than silently diverging.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { STEPS, PROFILES, COMMUTES, GZIP_ARTIFACTS, stepById, stepsFor } from "../scripts/lib/build-steps.mjs";

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");

const byPnpmScript = new Map(STEPS.map((s) => [s.pnpmScript, s]));
const canonicalIndex = new Map(STEPS.map((s, i) => [s.id, i]));
const commutes = new Set(COMMUTES.map(([a, b]) => [a, b].sort().join("|")));

/** package.json's `build`: `pnpm build:x && pnpm run build:y && vite build`. */
function parsePackageBuild(script: string): string[] {
  return script.split("&&").map((raw) => {
    const seg = raw.trim();
    const pnpm = /^pnpm (?:run )?([\w:-]+)$/.exec(seg);
    if (pnpm) {
      const step = byPnpmScript.get(pnpm[1]);
      if (!step) throw new Error(`package.json build runs "${pnpm[1]}", which is not a declared build step`);
      return step.id;
    }
    // package.json's last segment invokes the binary directly; "build:vite" is
    // literally "vite build", so this is the same step spelled differently.
    if (seg === "vite build") return "vite";
    throw new Error(`package.json build has an unrecognised segment: "${seg}"`);
  });
}

/** Dockerfile builder stage: `bun run build:x` occurrences, in order. */
function parseDockerBuild(text: string): string[] {
  return [...text.matchAll(/bun run (build:[\w-]+)/g)].map((m) => {
    const step = byPnpmScript.get(m[1]);
    if (!step) throw new Error(`Dockerfile runs "${m[1]}", which is not a declared build step`);
    return step.id;
  });
}

describe("build-steps: declaration integrity", () => {
  it("every step's script exists on disk and its pnpm script is declared", () => {
    for (const step of STEPS) {
      expect(pkg.scripts[step.pnpmScript], `package.json is missing "${step.pnpmScript}"`).toBeTruthy();
      if (step.script === null) continue;
      expect(fs.existsSync(path.join(ROOT, step.script)), `missing ${step.script}`).toBe(true);
      expect(step.name).toBe(path.basename(step.script).replace(/\.(mjs|ts)$/, ""));
      // The declared runner must be the one package.json actually uses.
      expect(pkg.scripts[step.pnpmScript]).toContain(step.runner === "bun" ? "bun " : "node ");
      expect(pkg.scripts[step.pnpmScript]).toContain(step.script);
    }
  });

  it("step ids are unique", () => {
    expect(new Set(STEPS.map((s) => s.id)).size).toBe(STEPS.length);
  });

  it("every profile names known steps, without repeats", () => {
    for (const [name, ids] of Object.entries(PROFILES)) {
      expect(new Set(ids).size, `profile "${name}" repeats a step`).toBe(ids.length);
      expect(stepsFor(name).map((s) => s.id)).toEqual(ids);
    }
  });

  it("stepById resolves a known step and rejects an unknown one", () => {
    expect(stepById("bundle").script).toBe("scripts/required/build-bundle.ts");
    expect(stepById("oea-report").name).toBe("build-oea-report");
    expect(() => stepById("build:bundle")).toThrow(/unknown step/);
    expect(() => stepsFor("nope")).toThrow(/unknown profile/);
  });

  it("profiles run by script path only contain script-backed steps", () => {
    // atlas-worker.mjs / refresh-atlas-build.mjs / preview/build.ts pass
    // step.script straight to a subprocess, so a null there would be a crash.
    for (const name of ["refresh", "worker", "preview"]) {
      for (const step of stepsFor(name)) {
        expect(step.script, `profile "${name}" step "${step.id}" has no script path`).not.toBeNull();
      }
    }
  });

  it("every profile keeps canonical order except for declared commuting pairs", () => {
    for (const [name, ids] of Object.entries(PROFILES)) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const [a, b] = [ids[i], ids[j]];
          if (canonicalIndex.get(a)! < canonicalIndex.get(b)!) continue;
          expect(
            commutes.has([a, b].sort().join("|")),
            `profile "${name}" runs ${a} before ${b}, inverting canonical order, and they are not declared as commuting`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("build-steps: non-JS consumers match their profile", () => {
  it("package.json `build` is the `full` profile", () => {
    expect(parsePackageBuild(pkg.scripts.build)).toEqual(PROFILES.full);
  });

  it("the Dockerfile builder stage is the `docker` profile", () => {
    expect(parseDockerBuild(dockerfile)).toEqual(PROFILES.docker);
  });

  it("the Dockerfile's hand-maintained gzip list is GZIP_ARTIFACTS", () => {
    const line = /\bgzip\b[^\n]*/.exec(dockerfile);
    expect(line, "Dockerfile has no gzip line").not.toBeNull();
    const files = [...line![0].matchAll(/dist\/([\w.-]+)/g)].map((m) => m[1]);
    expect(files).toEqual(GZIP_ARTIFACTS);
  });

  it("every gzipped artifact is produced by a step the docker profile runs", () => {
    // Nothing gzips an artifact the image never builds. search-index.json comes
    // from build-index, the rest from the step sharing its basename.
    expect(PROFILES.docker).toContain("index");
    for (const f of GZIP_ARTIFACTS) {
      const id = f.replace(/\.json$/, "");
      if (id === "search-index" || id === "relations") continue; // index / graph
      expect(PROFILES.docker, `${f} is gzipped but ${id} never runs in the image`).toContain(id);
    }
  });
});

// settlements.json is NOT an atlas build step — it fetches
// github.com/soterlabs/settlement-reports, so it can't live in a chain that must
// be offline and byte-reproducible at a fixed atlas sha (REPRO=1). It is baked
// into the image by its own Dockerfile line instead, and refreshed locally by
// dev-preflight. Neither site can import build-steps.mjs, so assert both here:
// if the bake silently disappears, Radar's Monthly settlement section goes blank
// in prod with no error anywhere (the artifact 404 is swallowed by design).
describe("settlements bake: the one prod producer of settlements.json", () => {
  const bake = /parse-settlements\.mjs/.exec(dockerfile);
  // The invocation is wrapped over two lines (args, then the `|| echo WARN`
  // fallback), so assert against a window rather than a single line.
  const invocation = bake ? dockerfile.slice(bake.index, bake.index + 200) : "";

  it("the Dockerfile bakes dist/settlements.json", () => {
    expect(bake, "Dockerfile no longer runs scripts/aux/parse-settlements.mjs").not.toBeNull();
    expect(invocation).toContain("--out dist/settlements.json");
  });

  it("bakes AFTER build:vite, which wipes dist/", () => {
    const vite = dockerfile.indexOf("bun run build:vite");
    expect(vite).toBeGreaterThan(-1);
    expect(bake!.index).toBeGreaterThan(vite);
  });

  it("a settlement-reports outage warns instead of failing the image", () => {
    // `… || echo WARN`: upstream being down must not break a deploy of the app.
    expect(invocation).toMatch(/\|\|\s*echo/);
  });

  it("dev-preflight refreshes it on every boot", () => {
    // The local half of the same guarantee: without this a fresh checkout has
    // no settlements.json and Radar hides the section with no error anywhere.
    const preflight = fs.readFileSync(path.join(ROOT, "scripts/aux/dev-preflight.mjs"), "utf8");
    expect(preflight).toContain("settlements:parse");
  });

  it("`pnpm build` does NOT run it — that chain stays offline + reproducible", () => {
    expect(pkg.scripts.build).not.toContain("settlements");
    expect(STEPS.map((s) => s.pnpmScript)).not.toContain("settlements:parse");
  });
});

describe("atlas artifact store: worker publish is load-bearing (phase 4)", () => {
  it("there is no updater build profile — the web hydrates from atlas_artifacts", () => {
    expect(PROFILES).not.toHaveProperty("updater");
  });

  it("atlas-worker fails the run when publish-artifacts fails", () => {
    const worker = fs.readFileSync(path.join(ROOT, "scripts/required/atlas-worker.mjs"), "utf8");
    expect(worker).toContain('run("bun", ["scripts/required/publish-artifacts.ts"])');
    expect(worker).not.toContain("web instances keep building their own");
    expect(worker).not.toMatch(/publish-artifacts failed[\s\S]*console\.warn/);
  });

  /** The exit code of the FIRST `process.exit` after `marker` — i.e. the one in
   *  that log line's own callback. A greedy `/marker[\\s\\S]*exit\\((\\d)\\)/` matches
   *  any later exit in the file instead, so it passed even with the tail
   *  callback mutated to exit(1) (the fast-exit path's exit(0) satisfied it).
   *  Non-greedy pins the callback body. */
  function exitCodeAfter(worker: string, marker: string): string | undefined {
    return new RegExp(`${marker}[\\s\\S]*?process\\.exit\\((\\d)\\)`).exec(worker)?.[1];
  }

  it("atlas-worker kills a hung tick so Railway cron can retry", () => {
    const worker = fs.readFileSync(path.join(ROOT, "scripts/required/atlas-worker.mjs"), "utf8");
    expect(worker).toContain("const HARD_CAP_MS = 15 * 60 * 1000");
    expect(worker).toContain("atlas-worker: hard cap (15m) — exiting so cron can retry");
    expect(worker).toContain("cap.unref()");
    expect(exitCodeAfter(worker, "hard cap \\(15m\\)")).toBe("1");
  });

  // 2026-09-25: a cold atlas_doc_embeddings is ~19 minutes of backfill, so the
  // flat 15m cap fired on the first tick of every new environment and reported
  // exit(1) — a "crashed" worker whose served snapshot had in fact committed at
  // T+12s. Running out of clock in the best-effort tails is partial progress the
  // next tick resumes, so the post-heartbeat deadline exits 0 instead.
  it("atlas-worker's post-heartbeat tail budget is a clean exit, armed on both paths", () => {
    const worker = fs.readFileSync(path.join(ROOT, "scripts/required/atlas-worker.mjs"), "utf8");
    expect(worker).toContain("const TAIL_CAP_MS = 11 * 60 * 1000");
    expect(exitCodeAfter(worker, "tail budget")).toBe("0");
    // Both heartbeat sites hand over to the tail deadline — the fast-exit path
    // runs the same best-effort tails as the rebuild path.
    const hbs = [...worker.matchAll(/await touchSyncHeartbeat\([^)]*\);\n\s*armTailCap\(\);/g)];
    expect(hbs.length).toBe(2);
  });

  // Only sync-embeddings resumes mid-walk; build-history and build-doc-versions
  // buffer and write once at the end, so a tail kill repeats their walk. The
  // comment must keep saying so — an "every lane is incremental" claim is what
  // the 2026-09-25 review caught, and it is the reason the budget is sized off
  // history's cold walk rather than off the embed rate alone.
  it("the worker does not claim all three tail lanes resume mid-walk", () => {
    const worker = fs.readFileSync(path.join(ROOT, "scripts/required/atlas-worker.mjs"), "utf8");
    expect(worker).toMatch(/Only ONE of the three lanes actually resumes mid-walk/);
    expect(worker).toMatch(/instead buffer the whole walk in memory and write once at/);
    expect(worker).not.toMatch(/every lane of it incremental/);
  });

  // The whole point of the tail deadline: the process must be gone before the
  // next tick claims the same backlog. A cron period edited below the budget
  // would silently reintroduce two workers re-embedding the same docs.
  it("the tail budget stays under the worker's cron period", () => {
    const worker = fs.readFileSync(path.join(ROOT, "scripts/required/atlas-worker.mjs"), "utf8");
    const toml = fs.readFileSync(path.join(ROOT, "railway.worker.toml"), "utf8");
    const tailMin = Number(/const TAIL_CAP_MS = (\d+) \* 60 \* 1000/.exec(worker)?.[1]);
    const everyMin = Number(/cronSchedule = "\*\/(\d+) \* \* \* \*"/.exec(toml)?.[1]);
    expect(tailMin).toBeGreaterThan(0);
    expect(everyMin).toBeGreaterThan(0);
    expect(tailMin).toBeLessThan(everyMin);
  });

  // `Math.max(FLOOR, TAIL_CAP_MS - elapsed)` has TWO thresholds, and the comment
  // blended them at first: the floor ENGAGES once the heartbeat passes
  // TAIL_CAP - FLOOR, but the */12 tick is only OUTLIVED once it passes
  // CRON - FLOOR. With 660s / 60s / 720s that is minute 10 vs minute 11, and
  // between them the floor is active while the process still exits inside its own
  // tick. Asserted as arithmetic so a change to any of the three constants shows
  // which of the two thresholds moved.
  it("the floor engages a full minute before it can outlive a tick", () => {
    const worker = fs.readFileSync(path.join(ROOT, "scripts/required/atlas-worker.mjs"), "utf8");
    const toml = fs.readFileSync(path.join(ROOT, "railway.worker.toml"), "utf8");
    const tail = Number(/const TAIL_CAP_MS = (\d+) \* 60 \* 1000/.exec(worker)?.[1]) * 60;
    const cron = Number(/cronSchedule = "\*\/(\d+) \* \* \* \*"/.exec(toml)?.[1]) * 60;
    const floor = Number(/Math\.max\((\d+) \* 1000, TAIL_CAP_MS/.exec(worker)?.[1]);
    expect(floor).toBe(60);

    const deadline = (hb: number) => hb + Math.max(floor, tail - hb);
    // Floor inactive: the deadline is exactly the budget, wherever the heartbeat lands.
    expect(deadline(12)).toBe(tail);
    expect(deadline(tail - floor)).toBe(tail);
    // Floor active from there, but still inside the tick all the way to CRON - FLOOR.
    expect(deadline(tail - floor + 1)).toBeGreaterThan(tail);
    expect(deadline(cron - floor)).toBe(cron);
    // Only past CRON - FLOOR does the process outlive its own tick.
    expect(deadline(cron - floor + 1)).toBeGreaterThan(cron);
    // The two thresholds are distinct, and the gap between them is CRON - TAIL.
    expect(cron - floor - (tail - floor)).toBe(cron - tail);
    expect(cron - tail).toBeGreaterThan(0);
  });

  it("atlas-worker heartbeats on the rebuild path, not only the fast exit", () => {
    // 2026-09-22: production cron rebuilt every 12 min (staleEmbeds=1) then
    // sync.ts no-op'd; heartbeat lived only on the skip path, so freshness
    // stayed 503 while Railway showed green ticks. After publish, not
    // after integrity: a failed publish must leave freshness stale.
    const worker = fs.readFileSync(path.join(ROOT, "scripts/required/atlas-worker.mjs"), "utf8");
    const calls = [...worker.matchAll(/await touchSyncHeartbeat\(/g)];
    expect(calls.length).toBe(2);
    const publish = worker.indexOf('run("bun", ["scripts/required/publish-artifacts.ts"])');
    const hb = worker.lastIndexOf("await touchSyncHeartbeat(verifyDb)");
    expect(publish).toBeGreaterThan(-1);
    expect(hb).toBeGreaterThan(publish);
  });
});
