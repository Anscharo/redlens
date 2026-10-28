// Retired atlas addresses: an address a commit adds and a later commit removes
// from every file is retired at that commit; one only moved between files, or
// still held at HEAD, is not. A key derived from a retired address is marked
// with it, and the walk reads a real git history.
import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LiveRateLimit, PauSnapshot } from "../../lib/pau.ts";
import { atlasRetiredAddresses, retiredFromLog, withRetiredKeys } from "./retired-addresses.ts";

const [JAAA, MOVED, KEPT] = ["0x" + "e9".repeat(20), "0x" + "77".repeat(20), "0x" + "aa".repeat(20)];
const commit = (sha: string, at: string, ...lines: string[]) => [`\u0001${sha} ${at}`, ...lines].join("\n");

describe("retiredFromLog", () => {
  const log = [
    commit("c1", "2025-07-04T12:00:00Z", "+++ b/a.md", `+| Token Address | ${JAAA} |`, `+${MOVED}`, `+${KEPT}`),
    commit("c2", "2025-08-01T12:00:00Z", "--- a/a.md", `-${MOVED}`, "+++ b/b.md", `+${MOVED}`),
    commit("c3", "2025-08-25T12:00:00Z", `-| Token Address | ${JAAA.toUpperCase().replace("0X", "0x")} |`),
  ].join("\n");

  it("dates a retired address by the commit after which no file holds it", () => {
    expect(retiredFromLog(log, `${MOVED}\n${KEPT}`)).toEqual(new Map([[JAAA, { address: JAAA, removedAt: "2025-08-25T12:00:00Z", commit: "c3" }]]));
  });
  it("never retires an address HEAD still holds, nor reads a 64-hex hash as an address", () => {
    expect(retiredFromLog(log, `${JAAA}\n${MOVED}`).size).toBe(0);
    expect(retiredFromLog(commit("c1", "t", `+0x${"ab".repeat(32)}`) + "\n" + commit("c2", "t", `-0x${"ab".repeat(32)}`), "").size).toBe(0);
  });
});

describe("atlasRetiredAddresses", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-hist-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });

  it("reads the checkout's history", () => {
    git("init", "-q");
    fs.writeFileSync(path.join(dir, "a.md"), `${JAAA}\n${KEPT}\n`);
    git("add", "."); git("commit", "-qm", "add");
    fs.writeFileSync(path.join(dir, "a.md"), `${KEPT}\n`);
    git("commit", "-qam", "drop");
    const sha = git("rev-parse", "HEAD").stdout.trim();
    expect([...atlasRetiredAddresses(dir).values()].map((r) => [r.address, r.commit])).toEqual([[JAAA, sha]]);
  });
});

describe("withRetiredKeys", () => {
  const limit = (key: string, args: string[]): LiveRateLimit => ({ key, configured: { maxAmount: "0", slope: "0" }, setAt: { block: 1, time: "", tx: "" }, changes: 1, data: null, available: null, derived: { constant: "LIMIT_7540_DEPOSIT", args } });
  const snap = { deployment: "d", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic", contracts: [{ role: "rateLimits", address: "0x1", events: 1, historyComplete: true, rateLimits: [limit("0x01", [JAAA.toUpperCase().replace("0X", "0x")]), limit("0x02", [KEPT])] }] } as PauSnapshot;
  const gone = { address: JAAA, removedAt: "2025-08-25T12:00:00Z", commit: "c3" };

  it("marks only the derivations that take a retired address", () => {
    const out = withRetiredKeys(snap, new Map([[JAAA, gone]])).contracts[0].rateLimits!;
    expect(out.map((r) => r.derived?.retired ?? null)).toEqual([gone, null]);
  });
  it("drops a mark whose address the atlas lists again", () => {
    const marked = withRetiredKeys(snap, new Map([[JAAA, gone]]));
    expect(withRetiredKeys(marked, new Map()).contracts[0].rateLimits!.map((r) => r.derived)).toEqual(snap.contracts[0].rateLimits!.map((r) => r.derived));
  });
});
