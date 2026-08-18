// Run via `bun test src/server`. Pure unit tests — no DB, no network.
import { test, expect } from "bun:test";
import { contentDiff } from "./patch-diff";

test("contentDiff: identical content → [] (a pure renumber shows no diff)", () => {
  expect(contentDiff("a\nb\nc", "a\nb\nc")).toEqual([]);
});

test("contentDiff: word edit → intraline with ±2 context and gaps", () => {
  const prev = ["one", "two", "three", "four", "five", "six", "the cat sat", "eight"].join("\n");
  const curr = ["one", "two", "three", "four", "five", "six", "the dog sat", "eight"].join("\n");
  const out = contentDiff(prev, curr);
  // lines one..four trimmed (outside ±2 context; no leading gap marker — same
  // convention as the live history lineDiff)
  expect(out[0]).toEqual(["=", "five"]);
  expect(out).toHaveLength(4);
  const intraline = out.find((l) => l[0] === "~");
  expect(intraline?.[1]).toEqual([
    ["=", "the "],
    ["-", "cat"],
    ["+", "dog"],
    ["=", " sat"],
  ]);
});

test("contentDiff: caps long output with trailing …", () => {
  const prev = "";
  const curr = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
  const out = contentDiff(prev, curr, 20);
  expect(out.length).toBe(21);
  expect(out[20]).toEqual(["…"]);
});

