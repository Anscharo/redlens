// Integration coverage for scripts/required/check-concepts-census.mjs — the
// census guard is a bun-run script with fixed relative paths (ROOT resolves
// from its own file location, not an env var), so it can't be unit-tested by
// importing it directly. Instead we materialize a minimal standalone copy of
// its relative layout (scripts/required + scripts/lib + src/lib/conceptsCensus.ts
// + public/docs.json + .github/) in a scratch dir and shell out to it with
// `bun`, exercising the guard's actual contract: baseline creation via
// --update, silence on a no-op rerun, [drift] warnings on an injected
// membership change, and the always-exit-0 guarantee.
//
// The pure census compute itself (conceptsCensus.ts) is already covered by
// vitest (src/lib/conceptsCensus.test.ts) — this file only covers the
// script-side integration: file I/O, baseline diffing, exit code.
import { test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
let tmpRoot: string;

function makeDocs(extra: Record<string, unknown> = {}) {
  return {
    atlasCommit: "deadbeef",
    nodes: {
      live1: {
        id: "live1",
        doc_no: "A.1.1.1",
        title: "List Of Live Things",
        type: "Core",
        content: "The current Live Things are:\n- one\n- two\n",
      },
      empty1: {
        id: "empty1",
        doc_no: "A.1.1.2",
        title: "List Of Empty Things",
        type: "Core",
        content: "The current Empty Things are:",
      },
      ...extra,
    },
  };
}

function runScript(args: string[] = []): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [path.join(tmpRoot, "scripts/required/check-concepts-census.mjs"), ...args], {
    cwd: tmpRoot,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "concepts-census-guard-"));
  fs.mkdirSync(path.join(tmpRoot, "scripts/required"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "scripts/lib"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "src/lib"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "src/types"), { recursive: true }); // unused, just in case of resolution probing
  fs.mkdirSync(path.join(tmpRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, ".github"), { recursive: true });

  fs.copyFileSync(
    path.join(REPO_ROOT, "scripts/required/check-concepts-census.mjs"),
    path.join(tmpRoot, "scripts/required/check-concepts-census.mjs"),
  );
  fs.copyFileSync(path.join(REPO_ROOT, "scripts/lib/natural-sort.mjs"), path.join(tmpRoot, "scripts/lib/natural-sort.mjs"));
  fs.copyFileSync(path.join(REPO_ROOT, "src/lib/conceptsCensus.ts"), path.join(tmpRoot, "src/lib/conceptsCensus.ts"));
  // conceptsCensus.ts only imports `type AtlasNode` from "../types" — a
  // type-only import bun erases at runtime, but give it a real (empty) module
  // so any tool that doesn't strip it still resolves.
  fs.writeFileSync(path.join(tmpRoot, "src/types.ts"), "export interface AtlasNode { [k: string]: unknown }\n");

  fs.writeFileSync(path.join(tmpRoot, "public/docs.json"), JSON.stringify(makeDocs()));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test("no baseline yet: warns but still exits 0, writes nothing without --update", () => {
  const r = runScript();
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(/no baseline found/);
  expect(fs.existsSync(path.join(tmpRoot, ".github/concepts-census-baseline.json"))).toBe(false);
});

test("--update creates the baseline and exits 0", () => {
  const r = runScript(["--update"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/baseline written/);
  const baselinePath = path.join(tmpRoot, ".github/concepts-census-baseline.json");
  expect(fs.existsSync(baselinePath)).toBe(true);
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  expect(baseline["registry-liveness"].members.map((m: { doc_no: string }) => m.doc_no)).toEqual(["A.1.1.1", "A.1.1.2"]);
});

test("rerun against an unchanged corpus is silent (no drift) and exits 0", () => {
  const r = runScript();
  expect(r.status).toBe(0);
  expect(r.stderr).toBe("");
  expect(r.stdout).toMatch(/0 drift warning/);
});

test("an injected new registry member triggers a [drift] warning, still exits 0", () => {
  fs.writeFileSync(
    path.join(tmpRoot, "public/docs.json"),
    JSON.stringify(
      makeDocs({
        live2: {
          id: "live2",
          doc_no: "A.1.1.3",
          title: "List Of New Things",
          type: "Core",
          content: "The current New Things are:\n- fresh\n",
        },
      }),
    ),
  );
  const r = runScript();
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(/\[drift\] concepts-census: registry-liveness: NEW member — A\.1\.1\.3/);
  expect(r.stdout).toMatch(/1 drift warning/);

  // Baseline file itself is untouched by a plain (non --update) run.
  const baseline = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".github/concepts-census-baseline.json"), "utf8"));
  expect(baseline["registry-liveness"].members).toHaveLength(2);
});

test("a bucket change (live -> empty) on an existing member also drifts", () => {
  fs.writeFileSync(
    path.join(tmpRoot, "public/docs.json"),
    JSON.stringify(
      makeDocs({
        live2: {
          id: "live2",
          doc_no: "A.1.1.3",
          title: "List Of New Things",
          type: "Core",
          content: "The current New Things are:",
        },
      }),
    ),
  );
  // Re-baseline first so "live2" is a known member with bucket "live" …
  runScript(["--update"]);
  // … then flip it to empty and confirm the bucket-change branch fires.
  fs.writeFileSync(
    path.join(tmpRoot, "public/docs.json"),
    JSON.stringify(
      makeDocs({
        live2: {
          id: "live2",
          doc_no: "A.1.1.3",
          title: "List Of New Things",
          type: "Core",
          content: "The current New Things are:\n- fresh\n",
        },
      }),
    ),
  );
  const r = runScript();
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(/changed bucket.*\["empty"\].*\["live"\]/);
});
