// The off-chain artifact refresh `pnpm dev` runs before boot
// (scripts/aux/dev-offchain-artifacts.ts): skip flags, the age gate, and the
// warning that says whether a failed refresh kept a file or left none.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureOffChainArtifacts } from "../scripts/aux/dev-offchain-artifacts.ts";

const truthy = (v: string | undefined) => v === "1" || v === "true";
let cwd: string;
let dir: string;

beforeEach(() => {
  cwd = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-offchain-"));
  fs.mkdirSync(path.join(dir, "public"));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(cwd);
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function harness(status: number) {
  const io = { log: vi.fn(), warn: vi.fn(), run: vi.fn(() => ({ status })), truthy };
  ensureOffChainArtifacts(io);
  return { scripts: io.run.mock.calls.map((c) => (c as unknown as [string, string[]])[1][0]), warnings: io.warn.mock.calls.flat() };
}

describe("ensureOffChainArtifacts", () => {
  it("refreshes both when neither exists, and says what is lost when a refresh fails", () => {
    const { scripts, warnings } = harness(1);
    expect(scripts).toEqual(["settlements:parse", "votes:sync"]);
    expect(warnings).toEqual([
      "settlements:parse failed — Radar's Monthly settlement section will be hidden.",
      "votes:sync failed — Stale Dates will show no vote evidence.",
    ]);
  });

  it("skips a fresh vote record but always refreshes the workbooks", () => {
    fs.writeFileSync("public/votes.json", "{}");
    fs.writeFileSync("public/settlements.json", "{}");
    const { scripts, warnings } = harness(1);
    expect(scripts).toEqual(["settlements:parse"]);
    expect(warnings).toEqual(["settlements:parse failed — keeping the public/settlements.json already on disk."]);
  });

  it("refreshes a vote record older than its age limit", () => {
    fs.writeFileSync("public/votes.json", "{}");
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000);
    fs.utimesSync("public/votes.json", old, old);
    expect(harness(0)).toEqual({ scripts: ["settlements:parse", "votes:sync"], warnings: [] });
  });

  it("honours the per-artifact and the build-wide skip flags", () => {
    vi.stubEnv("DEV_NO_VOTES", "1");
    expect(harness(0).scripts).toEqual(["settlements:parse"]);
    vi.stubEnv("DEV_NO_BUILD", "1");
    expect(harness(0).scripts).toEqual([]);
  });
});
