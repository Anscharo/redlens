// Regression test for the countNewAddresses silent-degrade bug: a torn/corrupt
// read of main's addresses.atlas.json used to be indistinguishable from
// "genuinely zero new addresses", hiding the swapped-payment-address banner.
// It now retries once, then returns undefined (not 0) so callers can tell
// "checked, zero" apart from "couldn't check".
import { afterAll, test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { countNewAddresses, baseMeta } from "./build.ts";
import type { Resolved } from "./resolve.ts";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pv-build-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// The two negative-path tests below drive countNewAddresses into its
// documented "couldn't check" branch, which console.errors the underlying
// SyntaxError/ENOENT with a full stack. That's correct in production and pure
// noise in a passing test run — and multi-line stacks interleaved into the
// suite output are exactly what makes a genuine CI failure hard to find. Mute
// it for the duration of those two tests only.
async function withoutErrorLogging<T>(fn: () => Promise<T>): Promise<T> {
  const realError = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = realError;
  }
}

function writeAddrs(dir: string, addresses: Record<string, unknown>) {
  fs.writeFileSync(path.join(dir, "addresses.atlas.json"), JSON.stringify({ atlasCommit: "x", addresses }));
}

test("counts addresses present in preview but absent from main", async () => {
  const previewDir = mkTmp();
  const mainDir = mkTmp();
  writeAddrs(previewDir, { "0xaaa": {}, "0xbbb": {}, "0xccc": {} });
  writeAddrs(mainDir, { "0xaaa": {} });
  expect(await countNewAddresses(previewDir, mainDir)).toBe(2);
});

test("returns 0 (not undefined) when main's file is well-formed and there's genuinely nothing new", async () => {
  const previewDir = mkTmp();
  const mainDir = mkTmp();
  writeAddrs(previewDir, { "0xaaa": {} });
  writeAddrs(mainDir, { "0xaaa": {} });
  expect(await countNewAddresses(previewDir, mainDir)).toBe(0);
});

test("a torn/corrupt main read returns undefined, not a false 0 (the bug)", async () => {
  const previewDir = mkTmp();
  const mainDir = mkTmp();
  writeAddrs(previewDir, { "0xaaa": {} });
  // Simulate a mid-rewrite torn read: truncated JSON.
  fs.writeFileSync(path.join(mainDir, "addresses.atlas.json"), '{"atlasCommit":"x","addresse');
  const result = await withoutErrorLogging(() => countNewAddresses(previewDir, mainDir));
  expect(result).toBeUndefined();
});

test("a missing preview file also returns undefined rather than 0", async () => {
  const previewDir = mkTmp(); // no addresses.atlas.json written
  const mainDir = mkTmp();
  writeAddrs(mainDir, { "0xaaa": {} });
  expect(await withoutErrorLogging(() => countNewAddresses(previewDir, mainDir))).toBeUndefined();
});

test("baseMeta maps the resolved ref onto PreviewMeta, incl. headCommitAt from the head-commit date", () => {
  const resolved: Resolved = {
    repo: "sky-ecosystem/next-gen-atlas",
    sha: "deadbeef",
    kind: "pr",
    ref: "pull-211",
    pr: { number: 211, title: "History tab", author: "anscharo", state: "open" },
    date: "2026-07-29T08:29:55Z",
  };
  const m = baseMeta(resolved, "deadbeef", 42, 0);
  expect(m.headCommitAt).toBe("2026-07-29T08:29:55Z");
  expect(m.sha).toBe("deadbeef");
  expect(m.repo).toBe("sky-ecosystem/next-gen-atlas");
  expect(m.kind).toBe("pr");
  expect(m.prNumber).toBe(211);
  expect(m.prTitle).toBe("History tab");
  expect(m.docCount).toBe(42);
  expect(typeof m.resolvedAt).toBe("string");
});

test("baseMeta leaves headCommitAt undefined when GitHub returned no date", () => {
  const resolved: Resolved = { repo: "o/r", sha: "abc", kind: "branch", ref: "feat/x" };
  expect(baseMeta(resolved, "abc", 1, 0).headCommitAt).toBeUndefined();
});
