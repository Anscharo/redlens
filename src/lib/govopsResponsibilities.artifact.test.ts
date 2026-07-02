// Tests for deriveGovOpsResponsibilities against the real built artifacts.
// Complements the synthetic-fixture tests in govopsResponsibilities.test.ts —
// those exercise discovery/classification/dedup logic in isolation; these catch
// anything that only shows up against real docs.json/relations.json shapes.
// Run `pnpm build:index && pnpm build:graph` first if public/ is stale.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode, RelationEdge, GraphEntity } from "../types";
import { deriveGovOpsResponsibilities, CATEGORY_LABELS } from "./govopsResponsibilities";

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

const results = deriveGovOpsResponsibilities(
  { docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: null },
  { participants, instances, invocations, primitives, edges: relations.edges },
);

const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

describe("deriveGovOpsResponsibilities (real artifacts)", () => {
  it("returns at least one result", () => {
    expect(results.length).toBeGreaterThan(0);
  });

  it("every result uuid exists in docs.json", () => {
    expect(results.filter((r) => !docs[r.uuid])).toEqual([]);
  });

  it("every result has a valid category", () => {
    expect(results.filter((r) => !VALID_CATEGORIES.has(r.category))).toEqual([]);
  });

  it("every result has a non-empty title", () => {
    expect(results.filter((r) => !r.title?.trim())).toEqual([]);
  });

  it("no uuid appears in more than one category (seenDocIds priority holds)", () => {
    const byUuid = new Map<string, Set<string>>();
    for (const r of results) {
      if (!byUuid.has(r.uuid)) byUuid.set(r.uuid, new Set());
      byUuid.get(r.uuid)!.add(r.category);
    }
    const conflicted = [...byUuid.entries()].filter(([, cats]) => cats.size > 1);
    expect(conflicted).toEqual([]);
  });

  it("includes at least one process-step result, each resolved to a real GovOps entity", () => {
    const ps = results.filter((r) => r.category === "process-step");
    expect(ps.length).toBeGreaterThan(0);
    const withoutGovops = ps.filter((r) => !r.govops?.trim());
    expect(withoutGovops).toEqual([]);
  });

  it("every process-step result's target doc is not an Active Data Controller", () => {
    const bad = results
      .filter((r) => r.category === "process-step")
      .filter((r) => docs[r.uuid]?.type === "Active Data Controller");
    expect(bad).toEqual([]);
  });

  it("includes at least one active-data result", () => {
    expect(results.some((r) => r.category === "active-data")).toBe(true);
  });

  it("includes at least one assignment result", () => {
    expect(results.some((r) => r.category === "assignment")).toBe(true);
  });

  it("captures multisig signer-modification duties (narrow phrase, not a bare verb)", () => {
    expect(results.some((r) => r.docNo === "A.1.10.4.1.1.5")).toBe(true); // Ethereum SkyLink Freezer Multisig Modification
  });

  it("does not silently collapse generic structural titles reused across unrelated primitives", () => {
    // "Process Flow" is reused by ~11 distinct Distribution Reward / Integration
    // Boost process-step docs outside the per-agent-artifact subtree — each must
    // keep its own row instead of being swallowed into one representative.
    const processFlowRows = results.filter((r) => r.title === "Process Flow");
    expect(processFlowRows.length).toBeGreaterThan(5);
  });
});
