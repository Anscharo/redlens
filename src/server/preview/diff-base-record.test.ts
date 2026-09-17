import { test, expect, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diffBaseLabel, readDiffCounts, diffBaseLogLine } from "./diff-base-record.ts";
import type { PreviewMeta } from "./cache.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diff-base-record-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const SKY = { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "f".repeat(40), behindBy: 14 };
const REPO = { repo: "acme/secret-atlas", ref: "main", mergeBase: "a".repeat(40) };
const meta = (m: Partial<PreviewMeta>): PreviewMeta =>
  ({ sha: "1234567890abcdef".padEnd(40, "0"), repo: "acme/secret-atlas", ref: "pull-7", kind: "branch", resolvedAt: "t", docCount: 1, buildMs: 1, ...m }) as PreviewMeta;

test("diffBaseLabel: branch@merge-base commit of the automatic pick", () => {
  expect(diffBaseLabel({ bases: { auto: "repo", sky: SKY, repo: REPO } })).toBe(`acme/secret-atlas:main@${"a".repeat(40)}`);
  expect(diffBaseLabel({ bases: { auto: "sky", sky: SKY, repo: REPO } })).toBe(`sky-ecosystem/next-gen-atlas:main@${"f".repeat(40)}`);
});

test("diffBaseLabel: live-main is sky main at the served atlas commit; unknown when even that is missing", () => {
  expect(diffBaseLabel({ bases: { auto: "live-main" }, baseAtlasCommit: "c".repeat(40) })).toBe(`sky-ecosystem/next-gen-atlas:main@${"c".repeat(40)}`);
  expect(diffBaseLabel({ bases: { auto: "live-main" } })).toBe("sky-ecosystem/next-gen-atlas:main@unknown");
});

test("diffBaseLabel: null when nothing was recorded, or the picked candidate is missing", () => {
  expect(diffBaseLabel({})).toBeNull();
  expect(diffBaseLabel({ bases: { auto: "repo", sky: SKY } })).toBeNull();
});

test("readDiffCounts: sizes of diff.json's lists; undefined when there is no readable diff.json", () => {
  fs.writeFileSync(path.join(tmp, "diff.json"), JSON.stringify({ added: ["a", "b"], changed: ["c"], renumbered: {} }));
  expect(readDiffCounts(tmp)).toEqual({ added: 2, changed: 1 });
  fs.writeFileSync(path.join(tmp, "diff.json"), JSON.stringify({})); // the serve-time fallback shape guards
  expect(readDiffCounts(tmp)).toEqual({ added: 0, changed: 0 });
  expect(readDiffCounts(path.join(tmp, "nope"))).toBeUndefined();
});

test("diffBaseLogLine: names the pick, the other candidate, the sizes and the served atlas — never the repo", () => {
  const line = diffBaseLogLine(meta({ bases: { auto: "repo", sky: SKY, repo: REPO }, baseAtlasCommit: "c".repeat(40), diffCounts: { added: 2, changed: 9 } }));
  expect(line).toBe("[preview] 12345678: redlined vs repo main@aaaaaaaa · +2 added, 9 changed · sky fork point ffffffff · 14 behind sky main · served atlas cccccccc");
  expect(line).not.toContain("acme");
});

test("diffBaseLogLine: a degrade carries its reason; a sky pick lists the repo candidate it passed over", () => {
  expect(diffBaseLogLine(meta({ bases: { auto: "live-main", reason: "no fork point found" }, baseAtlasCommit: "c".repeat(40) }))).toBe(
    "[preview] 12345678: redlined vs live-main @cccccccc · (no fork point found) · served atlas cccccccc",
  );
  expect(diffBaseLogLine(meta({ bases: { auto: "sky", reason: "candidates diverged", sky: SKY, repo: REPO } }))).toBe(
    "[preview] 12345678: redlined vs sky main@ffffffff · (candidates diverged) · 14 behind sky main · repo candidate main@aaaaaaaa · served atlas ?",
  );
  expect(diffBaseLogLine(meta({}))).toBe("[preview] 12345678: no diff base recorded · served atlas ?");
});
