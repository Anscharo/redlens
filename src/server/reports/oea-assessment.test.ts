// Pure unit test for the oea_assessment report builder. Runs under `bun test`
// (NOT vitest — src/server is excluded there). publicDir is injectable, so
// oea-report.json is read from a real temp file rather than config.publicDir.
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOeaAssessmentReport } from "./oea-assessment.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import type { OeaReportArtifact } from "../../lib/oeaReport.ts";

const IX = {} as Indexes; // unused by this builder — the artifact is pre-joined

function artifact(rows: OeaReportArtifact["rows"]): OeaReportArtifact {
  return {
    atlasCommit: "test",
    rubricVersion: "v1",
    model: "test-model",
    generatedAt: "2026-01-01T00:00:00Z",
    summary: { precision: { weak: 0, mid: 0, strong: 1 }, incentives: { weak: 0, mid: 1, strong: 0 }, stale: 0, unassessed: 0 },
    rows,
    mechanisms: {},
  };
}

function withArtifact<T>(a: OeaReportArtifact | null, fn: (publicDir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oea-test-"));
  if (a) fs.writeFileSync(path.join(dir, "oea-report.json"), JSON.stringify(a));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const NO_ELEMENTS = { actor: "present", trigger: "present", action: "present", timeBound: "present", completion: "present", discretion: "present" } as const;

const ROW: OeaReportArtifact["rows"][number] = {
  task: { taskKey: "t:x", uuid: "u1", docNo: "A.1.14.1", title: "Handle a claim", assessedText: "Do the thing.", quoted: true, category: "op-duty", sources: [] },
  entry: {
    taskKey: "t:x",
    uuid: "u1",
    docNo: "A.1.14.1",
    title: "Handle a claim",
    category: "op-duty",
    sources: [],
    precision: { rating: "strong", elements: NO_ELEMENTS, reasoning: "Very precise." },
    incentives: { rating: "mid", mechanismUuids: [], reasoning: "Some teeth." },
    assessedText: "Do the thing.",
    quoted: true,
    quoteHash: "h",
    docContentHash: "h",
    rubricVersion: "v1",
    model: "test-model",
  },
  status: "fresh",
};

test("buildOeaAssessmentReport serves the pre-joined artifact rows verbatim", () => {
  withArtifact(artifact([ROW]), (publicDir) => {
    const r = buildOeaAssessmentReport(IX, { include_provenance: true }, publicDir) as any;
    expect(r.report).toBe("oea_assessment");
    expect(r.total).toBe(1);
    expect(r.rubric_version).toBe("v1");
    expect(r.rows[0].entry.precision.reasoning).toBe("Very precise.");
  });
});

test("include_provenance:false strips reasoning but keeps the rating", () => {
  withArtifact(artifact([ROW]), (publicDir) => {
    const r = buildOeaAssessmentReport(IX, { include_provenance: false }, publicDir) as any;
    expect(r.rows[0].entry.precision.rating).toBe("strong");
    expect(r.rows[0].entry.precision.reasoning).toBe("");
  });
});

test("filter scopes rows by the same fields the report page searches", () => {
  withArtifact(artifact([ROW]), (publicDir) => {
    const r = buildOeaAssessmentReport(IX, { include_provenance: true, filter: "nonexistent" }, publicDir) as any;
    expect(r.total).toBe(0);
  });
});

test("missing oea-report.json degrades to zero rows, not a throw", () => {
  withArtifact(null, (publicDir) => {
    const r = buildOeaAssessmentReport(IX, { include_provenance: true }, publicDir) as any;
    expect(r.report).toBe("oea_assessment");
    expect(r.total).toBe(0);
    expect(r.rows).toEqual([]);
  });
});
