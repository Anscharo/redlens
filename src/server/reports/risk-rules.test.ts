// Pure unit test for the risk_rules report builder. Runs under `bun test` (NOT
// vitest — src/server is excluded there). Exercises the full path: keyword
// candidate enumeration (src/lib/riskRules.ts) joined against a triaged +
// assessed risk-assessment.json fixture (src/lib/riskAssessmentIndex.ts).
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRiskRulesReport } from "./risk-rules.ts";
import type { Indexes, AtlasNode } from "../retrieval/indexes.ts";
import type { RiskAssessmentArtifact } from "../../lib/riskAssessment.ts";

// "circuit breaker" + a metric matches the `sc` domain keyword regex with no
// anchor subtree needed — long enough to clear the 40-char empty-quote floor
// and shaped nothing like CONTAINER_RE's pointer-only opening clause.
const QUOTE = "An emergency circuit breaker halts trading whenever volatility exceeds a configured 10% threshold.";

function node(id: string, doc_no: string, title: string, content: string): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 3, parentId: null, order: 0, content, contentHash: `h-${id}`, addressRefs: [] } as AtlasNode;
}

function makeIx(): Indexes {
  const docs = [node("A", "A.1.9.1", "Circuit Breaker", QUOTE), node("B", "A.9.9", "No Risk Content Here", "Plain prose about nothing risky.")];
  const docMap = new Map(docs.map((d) => [d.id, d]));
  return {
    docMap,
    byDocNo: new Map(docs.map((d) => [d.doc_no, d])),
    entities: [],
    edges: [],
    meta: { atlasCommit: "test" },
  } as unknown as Indexes;
}

function artifact(over: Partial<RiskAssessmentArtifact> = {}): RiskAssessmentArtifact {
  return {
    rubricVersion: "rv1",
    atlasCommit: "test",
    triageModel: "gpt-triage",
    assessModel: "gpt-assess",
    triage: [{ taskKey: "u:A", quoteHash: "irrelevant", model: "gpt-triage", inScope: true, domains: ["sc"], isRule: true, description: "Halts trading on a vol spike." }],
    assessments: [
      {
        taskKey: "u:A",
        uuid: "A",
        docNo: "A.1.9.1",
        title: "Circuit Breaker",
        domains: ["sc"],
        agents: undefined,
        anchored: false,
        stub: false,
        hasMetrics: true,
        description: "Halts trading on a vol spike.",
        quote: QUOTE,
        quoteHash: "irrelevant",
        model: "gpt-assess",
        rubricVersion: "rv1",
        preciseness: 4,
        precisenessReasoning: "Names a concrete numeric threshold.",
        metrics: ["10%"],
        enforcement: "strong",
        mechanismUuids: [],
        enforcementReasoning: "Automated halt, not discretionary.",
      },
    ],
    ...over,
  };
}

function withArtifact<T>(a: RiskAssessmentArtifact | null, fn: (publicDir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "risk-test-"));
  if (a) fs.writeFileSync(path.join(dir, "risk-assessment.json"), JSON.stringify(a));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("buildRiskRulesReport enumerates a keyword-matched candidate and joins its assessment", () => {
  withArtifact(artifact(), (publicDir) => {
    const r = buildRiskRulesReport(makeIx(), { include_provenance: true }, publicDir) as any;
    expect(r.report).toBe("risk_rules");
    expect(r.total).toBe(1);
    expect(r.rubric_version).toBe("rv1");
    expect(r.rows[0].candidate.docNo).toBe("A.1.9.1");
    expect(r.rows[0].status).toBe("fresh");
    expect(r.rows[0].entry.enforcementReasoning).toBe("Automated halt, not discretionary.");
  });
});

test("include_provenance:false strips reasoning but keeps the rating", () => {
  withArtifact(artifact(), (publicDir) => {
    const r = buildRiskRulesReport(makeIx(), { include_provenance: false }, publicDir) as any;
    expect(r.rows[0].entry.enforcement).toBe("strong");
    expect(r.rows[0].entry.enforcementReasoning).toBe("");
  });
});

test("an edited quote (hash mismatch) flags the row stale", () => {
  const stale = artifact();
  stale.assessments[0]!.quote = "An emergency circuit breaker halts trading whenever volatility exceeds a configured 25% threshold.";
  withArtifact(stale, (publicDir) => {
    const r = buildRiskRulesReport(makeIx(), { include_provenance: true }, publicDir) as any;
    expect(r.rows[0].status).toBe("stale");
  });
});

test("missing risk-assessment.json degrades to zero triaged rows (all untriaged), not a throw", () => {
  withArtifact(null, (publicDir) => {
    const r = buildRiskRulesReport(makeIx(), { include_provenance: true }, publicDir) as any;
    expect(r.report).toBe("risk_rules");
    expect(r.total).toBe(0);
    expect(r.untriaged).toBe(1);
    expect(r.rubric_version).toBeNull();
  });
});
