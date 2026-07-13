// joinRisk semantics: triage gates the rows; assessment staleness compares
// the stored quote against the live text (never silently reuse a rating).

import { describe, it, expect } from "vitest";
import type { RiskCandidate } from "./riskRules";
import type { RiskAssessmentArtifact, RiskAssessmentEntry, RiskTriageEntry } from "./riskAssessment";
import { joinRisk, summarizeRisk, riskRowsToCSV } from "./riskAssessmentIndex";

const candidate = (taskKey: string, quote: string): RiskCandidate => ({
  taskKey, uuid: "u1", docNo: "A.3.1", title: "T", quote,
  domains: ["peg"], anchored: true, stub: false, hasMetrics: false,
});

const triage = (taskKey: string, over: Partial<RiskTriageEntry> = {}): RiskTriageEntry => ({
  taskKey, quoteHash: "x", model: "m", inScope: true, isRule: true,
  domains: ["peg"], description: "d", ...over,
});

const entry = (taskKey: string, quote: string, rubricVersion = "r1"): RiskAssessmentEntry => ({
  taskKey, uuid: "u1", docNo: "A.3.1", title: "T", domains: ["peg"],
  anchored: true, stub: false, hasMetrics: false, description: "d",
  quote, quoteHash: "x", model: "m", rubricVersion,
  preciseness: 4, precisenessReasoning: "r", metrics: ["5%"],
  enforcement: "mid", mechanismUuids: ["m1"], enforcementReasoning: "r",
});

const artifact = (t: RiskTriageEntry[], a: RiskAssessmentEntry[]): RiskAssessmentArtifact => ({
  rubricVersion: "r1", atlasCommit: null, triageModel: "m", assessModel: "m",
  triage: t, assessments: a,
});

describe("joinRisk", () => {
  it("fresh when the quote matches modulo whitespace", () => {
    const j = joinRisk([candidate("u:u1", "The  rule\ntext.")], artifact([triage("u:u1")], [entry("u:u1", "The rule text.")]));
    expect(j.rows[0].status).toBe("fresh");
  });

  it("stale when the quote changed — the rating stays visible, flagged", () => {
    const j = joinRisk([candidate("u:u1", "The NEW rule text.")], artifact([triage("u:u1")], [entry("u:u1", "The rule text.")]));
    expect(j.rows[0].status).toBe("stale");
    expect(j.rows[0].entry).not.toBeNull();
  });

  it("stale when the rubric moved on since the rating", () => {
    const j = joinRisk([candidate("u:u1", "The rule text.")], artifact([triage("u:u1")], [entry("u:u1", "The rule text.", "r0")]));
    expect(j.rows[0].status).toBe("stale");
  });

  it("unassessed when triaged in but not yet rated", () => {
    const j = joinRisk([candidate("u:u1", "x")], artifact([triage("u:u1")], []));
    expect(j.rows[0].status).toBe("unassessed");
  });

  it("rejected and untriaged candidates are counted, not rows (null artifact = all untriaged)", () => {
    const j = joinRisk(
      [candidate("u:u1", "x"), candidate("u:u2", "x"), candidate("u:u3", "x")],
      artifact([triage("u:u1", { isRule: false }), triage("u:u2", { inScope: false, domains: [] })], []),
    );
    expect(j.rows).toHaveLength(0);
    expect(j.rejected).toBe(2);
    expect(j.untriaged).toBe(1);
    expect(joinRisk([candidate("u:u1", "x")], null).untriaged).toBe(1);
  });

  it("riskRowsToCSV emits a header, maps domain labels, and blanks unassessed ratings", () => {
    const j = joinRisk(
      [candidate("u:u1", "The rule text."), candidate("u:u2", "other")],
      artifact([triage("u:u1"), triage("u:u2")], [entry("u:u1", "The rule text.")]),
    );
    const csv = riskRowsToCSV(j.rows);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain('"Doc No","Title","UUID","Risk Types","Status"');
    // Assessed row: domain label resolved, rating present.
    expect(lines[1]).toContain('"Peg Maintenance"');
    expect(lines[1]).toContain('"fresh"');
    expect(lines[1]).toContain('"4"');
    // Unassessed row: rating columns blank (Precision/Precision Reasoning/Incentives).
    expect(lines[2]).toContain('"unassessed","","",""');
  });

  it("riskRowsToCSV exports the ASSESSED quote for stale rows, not the current Atlas text", () => {
    // Stale: the atlas paragraph changed since the rating. The exported quote
    // must match the ratings (the old assessed text), not the live paragraph.
    const j = joinRisk(
      [candidate("u:u1", "The NEW rule text.")],
      artifact([triage("u:u1")], [entry("u:u1", "The OLD rule text.")]),
    );
    expect(j.rows[0].status).toBe("stale");
    const csv = riskRowsToCSV(j.rows);
    expect(csv).toContain('"The OLD rule text."');
    expect(csv).not.toContain("The NEW rule text.");
  });

  it("riskRowsToCSV falls back to the live paragraph when a row is unassessed", () => {
    const j = joinRisk([candidate("u:u1", "Live paragraph.")], artifact([triage("u:u1")], []));
    expect(j.rows[0].status).toBe("unassessed");
    expect(riskRowsToCSV(j.rows)).toContain('"Live paragraph."');
  });

  it("re-expands a collapsed agent-artifact rule into one row per copy", () => {
    const rep: RiskCandidate = {
      ...candidate("t:shared rule|risk", "Spark must hold coverage."),
      docNo: "A.6.1.1.1.5.1",
      agents: ["Spark", "Grove"],
      copies: [
        { uuid: "u1", docNo: "A.6.1.1.1.5.1", quote: "Spark must hold coverage.", agent: "Spark" },
        { uuid: "u2", docNo: "A.6.1.1.2.5.1", quote: "Grove must hold coverage.", agent: "Grove" },
      ],
    };
    const j = joinRisk(
      [rep],
      artifact([triage("t:shared rule|risk")], [entry("t:shared rule|risk", "Spark must hold coverage.")]),
    );
    expect(j.rows).toHaveLength(2);
    // Each row points at that agent's own doc and carries only its agent…
    expect(j.rows.map((r) => r.candidate.docNo)).toEqual(["A.6.1.1.1.5.1", "A.6.1.1.2.5.1"]);
    expect(j.rows.map((r) => r.candidate.agents)).toEqual([["Spark"], ["Grove"]]);
    expect(j.rows.map((r) => r.candidate.taskKey)).toEqual(["u:u1", "u:u2"]);
    // …while sharing the rep's assessment and status.
    for (const r of j.rows) {
      expect(r.entry?.taskKey).toBe("t:shared rule|risk");
      expect(r.status).toBe("fresh");
    }
    // CSV exports each copy's OWN paragraph, not the representative's.
    const csv = riskRowsToCSV(j.rows);
    expect(csv).toContain('"Grove must hold coverage."');
  });

  it("summarizeRisk counts ratings and statuses", () => {
    const j = joinRisk(
      [candidate("u:u1", "The rule text."), candidate("u:u2", "other")],
      artifact([triage("u:u1"), triage("u:u2")], [entry("u:u1", "The rule text.")]),
    );
    const s = summarizeRisk(j.rows);
    expect(s.preciseness[4]).toBe(1);
    expect(s.enforcement.mid).toBe(1);
    expect(s.unassessed).toBe(1);
    expect(s.stale).toBe(0);
  });
});
