import { test, expect, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diffBaseType, diffBaseHasLca, diffBaseLabel, diffBaseCandidates, readDiffCounts, diffBaseLogLine } from "./diff-base-record.ts";
import type { PreviewMeta } from "./cache.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diff-base-record-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NGA = { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "f".repeat(40), behindBy: 14 };
const OWN = { repo: "acme/secret-atlas", ref: "main", mergeBase: "a".repeat(40) };
const PR_BASE = { repo: "acme/secret-atlas", ref: "main" };
const meta = (m: Partial<PreviewMeta>): PreviewMeta =>
  ({ sha: "1234567890abcdef".padEnd(40, "0"), repo: "acme/secret-atlas", ref: "pull-7", kind: "branch", resolvedAt: "t", docCount: 1, buildMs: 1, ...m }) as PreviewMeta;

test("diffBaseType: the internal `repo` slot is pr-base with a declared PR base, fork-default without one", () => {
  expect(diffBaseType({ bases: { auto: "repo", repo: OWN }, prBase: PR_BASE })).toBe("pr-base");
  // A branch preview, or a PR whose base could not be read (the default branch stands in).
  expect(diffBaseType({ bases: { auto: "repo", repo: OWN } })).toBe("fork-default");
});

test("diffBaseType: both the nga-main LCA and the no-LCA degrade are nga-main — the LCA flag tells them apart", () => {
  expect(diffBaseType({ bases: { auto: "sky", sky: NGA } })).toBe("nga-main");
  expect(diffBaseHasLca({ bases: { auto: "sky", sky: NGA } })).toBe(true);
  expect(diffBaseType({ bases: { auto: "live-main", reason: "no fork point found" } })).toBe("nga-main");
  expect(diffBaseHasLca({ bases: { auto: "live-main" } })).toBe(false);
  expect(diffBaseHasLca({ bases: { auto: "repo", repo: OWN } })).toBe(true);
});

test("nothing recorded (cold start) is null across the board, never a guessed type", () => {
  expect(diffBaseType({})).toBeNull();
  expect(diffBaseHasLca({})).toBeNull();
  expect(diffBaseLabel({})).toBeNull();
  expect(diffBaseCandidates({})).toBeNull();
});

test("diffBaseLabel: branch@LCA commit of the pick; with no LCA, nga main at the served atlas commit", () => {
  expect(diffBaseLabel({ bases: { auto: "repo", sky: NGA, repo: OWN } })).toBe(`acme/secret-atlas:main@${"a".repeat(40)}`);
  expect(diffBaseLabel({ bases: { auto: "sky", sky: NGA, repo: OWN } })).toBe(`sky-ecosystem/next-gen-atlas:main@${"f".repeat(40)}`);
  expect(diffBaseLabel({ bases: { auto: "live-main" }, baseAtlasCommit: "c".repeat(40) })).toBe(`sky-ecosystem/next-gen-atlas:main@${"c".repeat(40)}`);
  expect(diffBaseLabel({ bases: { auto: "live-main" } })).toBe("sky-ecosystem/next-gen-atlas:main@unknown");
  expect(diffBaseLabel({ bases: { auto: "repo", sky: NGA } })).toBeNull(); // picked slot missing
});

test("diffBaseCandidates: every resolved candidate, re-keyed by type — no internal slot names leak into the row", () => {
  expect(diffBaseCandidates({ bases: { auto: "repo", sky: NGA, repo: OWN }, prBase: PR_BASE })).toEqual({
    candidates: { "nga-main": NGA, "pr-base": OWN },
  });
  expect(diffBaseCandidates({ bases: { auto: "sky", reason: "candidates diverged", sky: NGA, repo: OWN } })).toEqual({
    reason: "candidates diverged",
    candidates: { "nga-main": NGA, "fork-default": OWN },
  });
  expect(diffBaseCandidates({ bases: { auto: "live-main", reason: "no fork point found" } })).toEqual({ reason: "no fork point found", candidates: {} });
  const rec = diffBaseCandidates({ bases: { auto: "repo", sky: NGA, repo: OWN } })!;
  expect(Object.keys(rec)).toEqual(["candidates"]); // no `auto` — the pick is the diff_base_type column
  expect(Object.keys(rec.candidates).sort()).toEqual(["fork-default", "nga-main"]);
});

test("readDiffCounts: sizes of diff.json's lists; undefined when there is no readable diff.json", () => {
  fs.writeFileSync(path.join(tmp, "diff.json"), JSON.stringify({ added: ["a", "b"], changed: ["c"], renumbered: {} }));
  expect(readDiffCounts(tmp)).toEqual({ added: 2, changed: 1 });
  fs.writeFileSync(path.join(tmp, "diff.json"), JSON.stringify({}));
  expect(readDiffCounts(tmp)).toEqual({ added: 0, changed: 0 });
  expect(readDiffCounts(path.join(tmp, "nope"))).toBeUndefined();
});

test("diffBaseLogLine: names the type, the LCA, the other candidate, the sizes and the served atlas — never the repo", () => {
  const line = diffBaseLogLine(meta({ bases: { auto: "repo", sky: NGA, repo: OWN }, baseAtlasCommit: "c".repeat(40), diffCounts: { added: 2, changed: 9 } }));
  expect(line).toBe("[preview] 12345678: redlined vs fork-default main@aaaaaaaa (LCA) · +2 added, 9 changed · nga-main LCA ffffffff · 14 behind nga-main · served atlas cccccccc");
  expect(line).not.toContain("acme");
  expect(diffBaseLogLine(meta({ bases: { auto: "repo", repo: OWN }, prBase: PR_BASE }))).toBe(
    "[preview] 12345678: redlined vs pr-base main@aaaaaaaa (LCA) · served atlas ?",
  );
});

test("diffBaseLogLine: the no-LCA degrade is loud and carries its reason; an nga-main pick lists the candidate it passed over", () => {
  expect(diffBaseLogLine(meta({ bases: { auto: "live-main", reason: "no fork point found" }, baseAtlasCommit: "c".repeat(40) }))).toBe(
    "[preview] 12345678: redlined vs nga-main TIP @cccccccc · NO LCA · (no fork point found) · served atlas cccccccc",
  );
  expect(diffBaseLogLine(meta({ bases: { auto: "sky", reason: "candidates diverged", sky: NGA, repo: OWN } }))).toBe(
    "[preview] 12345678: redlined vs nga-main main@ffffffff (LCA) · (candidates diverged) · 14 behind nga-main · fork-default candidate main@aaaaaaaa · served atlas ?",
  );
  expect(diffBaseLogLine(meta({}))).toBe("[preview] 12345678: no diff base recorded · served atlas ?");
});
