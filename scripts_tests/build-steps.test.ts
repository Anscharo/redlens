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
    // atlas-updater.ts / atlas-worker.mjs / refresh-atlas-build.mjs pass
    // step.script straight to a subprocess, so a null there would be a crash.
    for (const name of ["refresh", "worker", "updater", "preview"]) {
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
      if (id === "docs" || id === "search-index" || id === "relations") continue; // index / graph
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
