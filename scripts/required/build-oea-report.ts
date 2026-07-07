#!/usr/bin/env bun
// Build the joined OEA report artifact consumed by the UI and future tools.
// Ratings stay in public/oea-assessment.json; this pass joins them against the
// current task universe and applies the same doc-hash freshness rule as
// scripts/aux/assess-oea.ts.

import fs from "node:fs";
import path from "node:path";
import type { AtlasNode, GraphEntity, RelationEdge } from "../../src/types";
import type { OeaAssessmentArtifact } from "../../src/lib/oeaAssessment";
import { enumerateOeaTasks } from "../../src/lib/oeaTasks";
import { createOeaReport } from "../../src/lib/oeaReport";

const ROOT = path.resolve(import.meta.dir, "../..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(PUBLIC, "oea-report.json");

const docsFile = JSON.parse(fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8")) as {
  atlasCommit: string | null;
  nodes: Record<string, AtlasNode>;
};
const relations = JSON.parse(fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8")) as {
  entities: GraphEntity[];
  edges: RelationEdge[];
};
const assessment = fs.existsSync(path.join(PUBLIC, "oea-assessment.json"))
  ? JSON.parse(fs.readFileSync(path.join(PUBLIC, "oea-assessment.json"), "utf8")) as OeaAssessmentArtifact
  : null;

const participants = relations.entities.filter(
  (e) => e.et !== "instance" && e.et !== "invocation" && e.et !== "primitive",
);
const tasks = enumerateOeaTasks(
  { docs: docsFile.nodes, byParent: new Map(), docNoToId: new Map(), atlasCommit: docsFile.atlasCommit },
  { participants, instances: [], invocations: [], primitives: [], edges: relations.edges },
);
const report = createOeaReport(tasks, assessment, docsFile.nodes);

fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

const byCategory = Object.fromEntries(
  Object.entries(Object.groupBy(report.rows, (r) => r.task.category)).map(([k, v]) => [k, v?.length ?? 0]),
);
const byStatus = Object.fromEntries(
  Object.entries(Object.groupBy(report.rows, (r) => r.status)).map(([k, v]) => [k, v?.length ?? 0]),
);
console.log("=== OEA Report ===");
console.log(`tasks: ${report.rows.length} · by category: ${JSON.stringify(byCategory)}`);
console.log(`status: ${JSON.stringify(byStatus)} · mechanisms: ${Object.keys(report.mechanisms).length}`);
console.log(`rubric: ${report.rubricVersion ?? "unknown"} · model: ${report.model ?? "unknown"}`);
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
