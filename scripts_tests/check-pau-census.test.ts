// The census:pau script's contract, run with bun against a scratch checkout
// (--root) and a snapshot file (--snapshots): --update writes the baseline and
// a rerun is silent; a changed chain value is drift; an empty or stale source
// is one drift line and --update leaves the baseline byte for byte; and every
// one of these exits 0. The census and its rules are covered in
// src/lib/pauCensus.test.ts and src/lib/pauCensusDiff.test.ts.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../scripts/required/check-pau-census.ts");
const KEY = "0x" + "1".repeat(64);
let root: string;

const params = { "Inflow RateLimitID": [KEY, "doc-id"], "Inflow Rate Limits / maxAmount": ["5,000,000 USDC", "doc-max"] };
const graph = {
  entities: [
    { id: "p1", slug: "p1", name: "Prime One", entity_type: "participant", subtype: "prime", defining_doc_id: "p1", is_active: 1, meta: "{}" },
    { id: "i1", slug: "i1", name: "Ethereum Mainnet - Vault", entity_type: "instance", subtype: null, defining_doc_id: "i1", is_active: 1, meta: JSON.stringify({ agent_doc_id: "p1", params }) },
  ],
};
const snapshots = (maxAmount: string, fetchedAt = new Date().toISOString()) => ({
  deployments: [{
    deployment: "p1:ethereum", prime: "p1", primeName: "Prime One", chain: "ethereum", kind: "monolithic", fetchedAt,
    contracts: [{
      role: "rateLimits", address: "0x" + "f".repeat(40), events: 1, historyComplete: true,
      rateLimits: [{ key: KEY, configured: { maxAmount, slope: "0" }, setAt: { block: 1, time: "t", tx: "0xt" }, changes: 1, data: { maxAmount, slope: "0", lastAmount: "0", lastUpdated: "0" }, available: maxAmount, unit: { decimals: 6, symbol: "USDC", source: "token" } }],
    }],
  }],
});

function run(snaps: object, ...args: string[]) {
  const file = path.join(root, "snapshots.json");
  fs.writeFileSync(file, JSON.stringify(snaps));
  const r = spawnSync("bun", [SCRIPT, "--root", root, "--snapshots", file, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
const baseline = () => fs.readFileSync(path.join(root, ".github/pau-census-baseline.json"), "utf8");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pau-census-"));
  fs.mkdirSync(path.join(root, "public"));
  fs.mkdirSync(path.join(root, ".github"));
  fs.writeFileSync(path.join(root, "public/graph.json"), JSON.stringify(graph));
  fs.writeFileSync(path.join(root, "public/docs.json"), JSON.stringify({ nodes: { "doc-max": { doc_no: "A.1.2" } } }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("check-pau-census", () => {
  it("writes the baseline with --update, then reruns silently", () => {
    const first = run(snapshots("5000000000000"), "--update");
    expect(first.status).toBe(0);
    expect(JSON.parse(baseline()).counts).toEqual({ match: 1 });
    const again = run(snapshots("5000000000000"));
    expect(again).toMatchObject({ status: 0, stderr: "" });
    expect(again.stdout).toContain("1 values on 1 deployments: 1 match; 0 drift warning(s)");
  });
  it("warns on a changed chain value and still exits 0", () => {
    run(snapshots("5000000000000"), "--update");
    const r = run(snapshots("1"));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("[drift] pau-census: NEW mismatch — Prime One · Ethereum Mainnet - Vault · Inflow maxAmount (A.1.2, doc-max)");
  });
  it("skips an empty source and leaves the baseline as it is", () => {
    run(snapshots("5000000000000"), "--update");
    const before = baseline();
    const r = run({ deployments: [] }, "--update");
    expect(r.status).toBe(0);
    expect(r.stderr.trim().split("\n")).toEqual([expect.stringContaining("[drift] pau-census:") ]);
    expect(baseline()).toBe(before);
  });
  it("compares a stale source but refuses to accept it", () => {
    run(snapshots("5000000000000"), "--update");
    const before = baseline();
    const r = run(snapshots("1", new Date(Date.now() - 10 * 3_600_000).toISOString()), "--update");
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("hours old");
    expect(r.stderr).toContain("NEW mismatch");
    expect(r.stdout).toContain("--update refused");
    expect(baseline()).toBe(before);
  });
});
