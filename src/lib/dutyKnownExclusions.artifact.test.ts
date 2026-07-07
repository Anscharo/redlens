// Regression guard for confirmed duty-attribution false positives (see
// ./data/duty-known-exclusions.json). These are real docs whose phrasing
// closely resembles a duty grant but isn't one — each entry records which
// graph-duties.mjs guard keeps it excluded. Unlike the census baseline (which
// only flags a duty silently disappearing), this test flags the opposite
// regression: a confirmed-excluded doc starting to reappear as a row, e.g.
// because a future regex change loosened the guard that excludes it.
// Run `pnpm build:index && pnpm build:graph` first if public/ is stale.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode, RelationEdge, GraphEntity } from "../types";
import { deriveGovOpsResponsibilities } from "./govopsResponsibilities";
import { deriveFacilitatorResponsibilities } from "./facilitatorResponsibilities";
import exclusions from "./data/duty-known-exclusions.json";

const ROOT = path.resolve(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");

const docs: Record<string, AtlasNode> = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8"),
).nodes;
const relations: { entities: GraphEntity[]; edges: RelationEdge[] } = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8"),
);

const participants = relations.entities.filter(
  (e) => e.et !== "instance" && e.et !== "invocation" && e.et !== "primitive",
);
const instances = relations.entities.filter((e) => e.et === "instance");
const invocations = relations.entities.filter((e) => e.et === "invocation");
const primitives = relations.entities.filter((e) => e.et === "primitive");

const bundle = { docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: null };
const graph = { participants, instances, invocations, primitives, edges: relations.edges };

const rowsByRole = {
  govops: deriveGovOpsResponsibilities(bundle, graph),
  facilitator: deriveFacilitatorResponsibilities(bundle, graph),
};

describe("duty-known-exclusions (real artifacts)", () => {
  for (const entry of exclusions) {
    it(`${entry.docNo} stays excluded from the ${entry.excludedRole} report (${entry.reason.slice(0, 60)}…)`, () => {
      const rows = rowsByRole[entry.excludedRole as keyof typeof rowsByRole];
      expect(rows.some((r) => r.uuid === entry.uuid)).toBe(false);
    });
  }
});
