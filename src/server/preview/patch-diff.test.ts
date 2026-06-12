// Run via `bun test src/server`. Pure unit tests — no DB, no network.
import { test, expect } from "bun:test";
import { patchToDiffLines } from "./patch-diff";

test("returns [] for empty/missing patch", () => {
  expect(patchToDiffLines("")).toEqual([]);
  expect(patchToDiffLines(undefined)).toEqual([]);
  expect(patchToDiffLines(null)).toEqual([]);
});

test("renders an added file as all-+ lines", () => {
  // GitHub patch for a `status: added` file: single hunk, every line a +.
  const patch = ["@@ -0,0 +1,3 @@", "+# New Doc", "+", "+Body text."].join("\n");
  expect(patchToDiffLines(patch)).toEqual([
    ["+", "# New Doc"],
    ["+", ""],
    ["+", "Body text."],
  ]);
});

test("word-diffs a one-word edit into an intraline ~ line", () => {
  const patch = [
    "@@ -1,5 +1,5 @@",
    " # Title",
    " ",
    "-The cat sat on the mat.",
    "+The cat sat on the rug.",
    " ",
    " End.",
  ].join("\n");
  const out = patchToDiffLines(patch);
  expect(out[0]).toEqual(["=", "# Title"]);
  expect(out[1]).toEqual(["=", ""]);
  // shared prefix → intraline word diff, not separate −/+
  expect(out[2][0]).toBe("~");
  expect(out[2][1]).toEqual([
    ["=", "The cat sat on the "],
    ["-", "mat"],
    ["+", "rug"],
    ["=", "."],
  ]);
  expect(out[3]).toEqual(["=", ""]);
  expect(out[4]).toEqual(["=", "End."]);
});

test("keeps wholly-different lines as separate −/+ (no shared token)", () => {
  // Single tokens that share nothing — not even whitespace — so wordDiff finds
  // no "=" segment and the pair stays as separate −/+ (matches live lineDiff).
  const patch = ["@@ -1,1 +1,1 @@", "-alpha", "+zeta"].join("\n");
  expect(patchToDiffLines(patch)).toEqual([
    ["-", "alpha"],
    ["+", "zeta"],
  ]);
});

test("lines sharing only whitespace become intraline (faithful to live history)", () => {
  const patch = ["@@ -1,1 +1,1 @@", "-alpha beta", "+zeta eta"].join("\n");
  const out = patchToDiffLines(patch);
  expect(out[0][0]).toBe("~"); // shared " " token → intraline, not separate −/+
});

test("separates multiple hunks with a … gap", () => {
  const patch = [
    "@@ -1,2 +1,2 @@",
    " keep a",
    "-old one",
    "+new one",
    "@@ -40,2 +40,2 @@",
    " keep b",
    "-old two",
    "+new two",
  ].join("\n");
  const out = patchToDiffLines(patch);
  const gapIdx = out.findIndex((l) => l[0] === "…");
  expect(gapIdx).toBeGreaterThan(0);
  expect(out.slice(0, gapIdx).some((l) => l[0] === "=" && l[1] === "keep a")).toBe(true);
  expect(out.slice(gapIdx + 1).some((l) => l[0] === "=" && l[1] === "keep b")).toBe(true);
});

test("caps long output and appends a trailing …", () => {
  const body = Array.from({ length: 30 }, (_, i) => `+line ${i}`);
  const patch = ["@@ -0,0 +1,30 @@", ...body].join("\n");
  const out = patchToDiffLines(patch, 20);
  expect(out.length).toBe(21);
  expect(out[20]).toEqual(["…"]);
});

test("ignores the \\ No newline marker", () => {
  const patch = ["@@ -1,1 +1,1 @@", "-a", "\\ No newline at end of file", "+b", "\\ No newline at end of file"].join("\n");
  expect(patchToDiffLines(patch)).toEqual([
    ["-", "a"],
    ["+", "b"],
  ]);
});
