// joinAssessments staleness semantics (rubric §Process: never silently reuse a
// rating once the assessed text changes). Ported from the now-deleted
// oeaAssessmentIndex.test.ts — oeaAssessmentIndex.ts was a dead re-export
// shim with no production importers (see FIX 5).

import { describe, it, expect } from "vitest";
import type { OeaTask } from "./oeaTasks";
import type { OeaAssessmentArtifact, OeaAssessmentEntry } from "./oeaAssessment";
import { joinAssessments, summarize, oeaRowsToCSV } from "./oeaReport";

const task = (taskKey: string, assessedText: string): OeaTask => ({
  taskKey, uuid: "u1", docNo: "A.1", title: "T", assessedText,
  quoted: true, category: "op-duty", sources: ["govops"],
});

const entry = (taskKey: string, assessedText: string, rubricVersion = "r1"): OeaAssessmentEntry => ({
  taskKey, uuid: "u1", docNo: "A.1", title: "T", category: "op-duty", sources: ["govops"],
  assessedText, quoted: true, quoteHash: "x", model: "m", rubricVersion,
  precision: { rating: "mid", elements: { actor: "present", trigger: "present", action: "present", timeBound: "absent", completion: "absent", discretion: "absent" }, reasoning: "r" },
  incentives: { rating: "weak", mechanismUuids: [], reasoning: "none found" },
});

const artifact = (entries: OeaAssessmentEntry[]): OeaAssessmentArtifact => ({
  rubricVersion: "r1", atlasCommit: null, model: "m", assessments: entries,
});

describe("joinAssessments", () => {
  it("fresh when text matches modulo whitespace", () => {
    const rows = joinAssessments([task("u:u1", "Do  the\nthing.")], artifact([entry("u:u1", "Do the thing.")]));
    expect(rows[0].status).toBe("fresh");
  });

  it("stale when the assessed text changed", () => {
    const rows = joinAssessments([task("u:u1", "Do the NEW thing.")], artifact([entry("u:u1", "Do the thing.")]));
    expect(rows[0].status).toBe("stale");
    expect(rows[0].entry).not.toBeNull(); // stale ratings stay visible, flagged
  });

  it("stale when the rubric moved on since the rating", () => {
    const rows = joinAssessments([task("u:u1", "Do the thing.")], artifact([entry("u:u1", "Do the thing.", "r0")]));
    expect(rows[0].status).toBe("stale");
  });

  it("stale when the full document changed even if assessed text is unchanged", () => {
    const e = { ...entry("u:u1", "Do the thing."), docContentHash: "old" };
    const rows = joinAssessments(
      [task("u:u1", "Do the thing.")],
      artifact([e]),
      { u1: { contentHash: "new" } },
    );
    expect(rows[0].status).toBe("stale");
  });

  it("unassessed when no entry exists (artifact missing entirely too)", () => {
    expect(joinAssessments([task("u:u2", "x")], artifact([]))[0].status).toBe("unassessed");
    expect(joinAssessments([task("u:u2", "x")], null)[0].status).toBe("unassessed");
  });

  it("summarize counts ratings and statuses", () => {
    const rows = joinAssessments(
      [task("u:u1", "Do the thing."), task("u:u2", "other")],
      artifact([entry("u:u1", "Do the thing.")]),
    );
    const s = summarize(rows);
    expect(s.precision.mid).toBe(1);
    expect(s.incentives.weak).toBe(1);
    expect(s.unassessed).toBe(1);
    expect(s.stale).toBe(0);
  });
});

describe("oeaRowsToCSV", () => {
  it("emits a header, maps the category label, and blanks unassessed ratings", () => {
    const rows = joinAssessments([task("u:u1", "Do the thing."), task("u:u2", "Other")], artifact([entry("u:u1", "Do the thing.")]));
    const lines = oeaRowsToCSV(rows).split("\r\n");
    expect(lines[0]).toContain('"Doc No","Title","UUID","Atlas Link","Category","Status"');
    // Assessed row carries the ratings + reasoning.
    expect(lines[1]).toContain('"mid"');
    expect(lines[1]).toContain('"weak"');
    expect(lines[1]).toContain('"fresh"');
    // Unassessed row leaves precision/reasoning/incentives blank.
    expect(lines[2]).toContain('"unassessed","","",""');
  });

  it("escapes a title containing a quote (delegates to shared toCSV)", () => {
    const rows = joinAssessments([{ ...task("u:u1", "x"), title: 'The "Big" Task' } as never], artifact([]));
    expect(oeaRowsToCSV(rows)).toContain('"The ""Big"" Task"');
  });

  it("re-expands a collapsed task (title-collapsed agent copies) into one CSV row per doc", () => {
    const collapsed: OeaTask = {
      ...task("t:weekly settlement|op-duty", "settles weekly"),
      uuid: "rep", docNo: "A.6.1.1.1.4.1",
      agents: ["Spark", "Hoku"],
      copies: [
        { docNo: "A.6.1.1.1.4.1", uuid: "rep", agent: "Spark" },
        { docNo: "A.6.1.1.2.4.1", uuid: "copy2", agent: "Hoku" },
      ],
    };
    const rows = joinAssessments([collapsed], artifact([]));
    const lines = oeaRowsToCSV(rows).split("\r\n");
    expect(lines.length).toBe(3); // header + 2 expanded rows, not 1 collapsed row
    expect(lines[1]).toContain('"rep"');
    expect(lines[1]).toContain('"Spark"');
    expect(lines[1]).not.toContain("Hoku");
    expect(lines[2]).toContain('"copy2"');
    expect(lines[2]).toContain('"Hoku"');
  });
});
