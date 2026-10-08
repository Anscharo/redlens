// The disk loader for votes.json (src/server/votes.ts). Runs under `bun test`.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVoteIndexFromDisk } from "./votes.ts";

const dir = mkdtempSync(join(tmpdir(), "votes-loader-"));
const missing = join(dir, "missing.json");
const file = join(dir, "votes.json");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const artifact = (date: string) => ({
  sources: { executives: "", polls: "", portal: null },
  executives: [{ file: `2026/e-${date}.md`, date, frontmatterDate: null, outOfSchedule: false, title: "", summary: "", address: null, sections: [], portal: null }],
  polls: [],
});

// Each write moves the mtime forward explicitly, so a fast filesystem cannot hide a change.
let tick = 1;
function write(text: string): void {
  writeFileSync(file, text);
  const t = new Date(Date.now() + tick++ * 5_000);
  utimesSync(file, t, t);
}

test("null without a file, then the first candidate that exists, reloaded when it changes", () => {
  expect(loadVoteIndexFromDisk([missing])).toBeNull();
  write(JSON.stringify(artifact("2026-03-26")));
  const first = loadVoteIndexFromDisk([missing, file]);
  expect(first?.first).toBe("2026-03-26");
  expect(loadVoteIndexFromDisk([missing, file])).toBe(first); // cached while unchanged
  write(JSON.stringify(artifact("2026-04-09")));
  expect(loadVoteIndexFromDisk([missing, file])?.first).toBe("2026-04-09");
});

test("null for a file that does not parse", () => {
  write("{ not json");
  expect(loadVoteIndexFromDisk([file])).toBeNull();
});

test("defaults to the repository and image paths", () => {
  // Whatever those hold in this checkout, the call must not throw.
  expect(() => loadVoteIndexFromDisk()).not.toThrow();
});
