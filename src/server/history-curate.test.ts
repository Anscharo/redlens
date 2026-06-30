// Unit tests for the dev-only curation save path (plan §10.4). writeDecisionsFile is the
// pure, target-injectable core behind POST /api/history-curate/save — it validates the
// shape and writes a FIXED filename under the given dir (so a client can't steer the path).
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeDecisionsFile } from "./history-curate.ts";

const decisionsFile = (decisions: unknown[]) => ({
  kind: "html-era-history-decisions",
  builtFrom: { migrationSha: "mig", lastHtmlSha: "html" },
  count: decisions.length,
  decisions,
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "curate-save-"));

describe("writeDecisionsFile", () => {
  it("writes the committed decisions file under a fixed name and returns the count", () => {
    const dir = tmp();
    try {
      const n = writeDecisionsFile(dir, decisionsFile([
        { caseKey: "a", chosenKey: "old:1", kind: "tier-3" },
        { caseKey: "b", chosenKey: "none", kind: "ambiguous" },
      ]));
      expect(n).toBe(2);
      const written = JSON.parse(fs.readFileSync(path.join(dir, "history-decisions.json"), "utf8"));
      expect(written.kind).toBe("html-era-history-decisions");
      expect(written.decisions).toHaveLength(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a body that isn't a decisions file (wrong kind / non-array), writing nothing", () => {
    const dir = tmp();
    try {
      expect(() => writeDecisionsFile(dir, { kind: "something-else", decisions: [] })).toThrow(/decisions file/);
      expect(() => writeDecisionsFile(dir, { kind: "html-era-history-decisions" })).toThrow(/decisions file/);
      expect(() => writeDecisionsFile(dir, null)).toThrow(/decisions file/);
      expect(fs.existsSync(path.join(dir, "history-decisions.json"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
