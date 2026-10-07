import { test, expect } from "bun:test";
import { renderPatch } from "./bundle-read.ts";
import { contentDiff } from "./patch-diff.ts";

test("an in-line edit renders as the whole old line then the whole new line", () => {
  const lines = contentDiff("- splitter.hop: 2,504 seconds", "- splitter.hop: 2,693 seconds");
  expect(renderPatch(lines, 10)).toEqual(["- - splitter.hop: 2,504 seconds", "+ - splitter.hop: 2,693 seconds"]);
});

test("added and removed lines keep their sign; the cap counts rendered lines", () => {
  const lines = contentDiff("a\nb\nc", "a\nB\nc\nd");
  const out = renderPatch(lines, 1);
  expect(out[0]).toMatch(/^[-+] /);
  expect(out.at(-1)).toMatch(/more lines\)$/);
});
