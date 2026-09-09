// Direct unit tests for the shared atlas_report builder helpers. Previously
// only covered incidentally through whichever report-builder tests happened
// to exercise a code path — none of them hit the malformed-JSON catch
// branches in parseMeta/parseDocNos, or readPublicJson's malformed-file case
// (only its "file missing" case, via the builders' own missing-artifact tests).
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPublicJson, parseMeta, parseDocNos } from "./util.ts";

function withTempFile<T>(name: string, contents: string, fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "util-test-"));
  fs.writeFileSync(path.join(dir, name), contents);
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── readPublicJson ───────────────────────────────────────────────────────────

test("readPublicJson parses a well-formed file", () => {
  withTempFile("x.json", JSON.stringify({ a: 1 }), (dir) => {
    expect(readPublicJson<{ a: number }>("x.json", dir)).toEqual({ a: 1 });
  });
});

test("readPublicJson returns null for a missing file, not a throw", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "util-test-empty-"));
  try {
    expect(readPublicJson("nope.json", dir)).toBeNull();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readPublicJson returns null for a malformed file, not a throw", () => {
  withTempFile("bad.json", "{ not valid json", (dir) => {
    expect(readPublicJson("bad.json", dir)).toBeNull();
  });
});

// ── parseMeta ─────────────────────────────────────────────────────────────────

test("parseMeta", () => {
  expect(parseMeta(null)).toEqual({});
  expect(parseMeta('{"resolution":"direct"}')).toEqual({ resolution: "direct" });
  // Guarded against a JSON array or scalar parsing "successfully" into
  // something that isn't the Record<string, unknown> callers expect.
  expect(parseMeta("[1,2,3]")).toEqual({});
  expect(parseMeta("42")).toEqual({});
  expect(parseMeta("{ not valid json")).toEqual({});
});

// ── parseDocNos ───────────────────────────────────────────────────────────────

test("parseDocNos", () => {
  expect(parseDocNos(null)).toEqual([]);
  // Current build format: a JSON array string.
  expect(parseDocNos('["A.1.1","A.1.2"]')).toEqual(["A.1.1", "A.1.2"]);
  expect(parseDocNos('["A.1.1", "", "A.1.2"]')).toEqual(["A.1.1", "A.1.2"]); // blanks filtered
  // Legacy comma list (not valid JSON at all) falls through to comma-split.
  expect(parseDocNos("A.1.1, A.1.2")).toEqual(["A.1.1", "A.1.2"]);
  // Valid JSON but not an array (e.g. a bare number) also falls through to
  // comma-split of the raw string — no comma present, so one whole token.
  expect(parseDocNos("42")).toEqual(["42"]);
});
