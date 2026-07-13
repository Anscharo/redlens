// Tests for deriveFacilitatorResponsibilities against the real built artifacts.
// Complements the synthetic-fixture tests in facilitatorResponsibilities.test.ts.
// Run `pnpm build:index && pnpm build:graph` first if public/ is stale.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode, RelationEdge, GraphEntity } from "../types";
import { deriveFacilitatorResponsibilities, CATEGORY_LABELS } from "./facilitatorResponsibilities";

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

const results = deriveFacilitatorResponsibilities(
  { docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: null },
  { participants, instances, invocations, primitives, edges: relations.edges },
);

const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

describe("deriveFacilitatorResponsibilities (real artifacts)", () => {
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

  it("a uuid appears in at most 2 categories, and only among {universal, core-facilitator, op-duty}", () => {
    // A doc can genuinely task both the Core and Operational side of the
    // role (e.g. a "Sky Governance path / Independent Governance path"
    // branch) — that's the ONE legitimate way a uuid spans two rows. 3+
    // categories, or a pairing that reaches outside this trio (e.g. pulling
    // in "assignment" or "active-data"), would mean seenDocIds priority broke.
    const DUTY_CATEGORIES = new Set(["universal", "core-facilitator", "op-duty"]);
    const byUuid = new Map<string, Set<string>>();
    for (const r of results) {
      if (!byUuid.has(r.uuid)) byUuid.set(r.uuid, new Set());
      byUuid.get(r.uuid)!.add(r.category);
    }
    const multi = [...byUuid.entries()].filter(([, cats]) => cats.size > 1);
    const invalid = multi.filter(([, cats]) => cats.size !== 2 || [...cats].some((c) => !DUTY_CATEGORIES.has(c)));
    expect(invalid).toEqual([]);
  });

  it("includes the universal Facilitator duties (A.1.7 family), each carrying all holders", () => {
    const universal = results.filter((r) => r.category === "universal");
    expect(universal.length).toBeGreaterThan(3);
    // Universal duties bind every holder — every row must carry more than one.
    expect(universal.filter((r) => (r.facilitators?.length ?? 0) < 2)).toEqual([]);
  });

  it("includes core-facilitator and op-duty rows", () => {
    expect(results.some((r) => r.category === "core-facilitator")).toBe(true);
    expect(results.some((r) => r.category === "op-duty")).toBe(true);
  });

  it("includes the per-agent root-edit duties, collapsed by content with agents accumulated", () => {
    // Identical replicas collapse, but genuine per-agent variants stay apart:
    // Spark's copy adds an author-compliance check the other agents' copies
    // don't have, so it keeps its own row. Every agent copy must survive
    // somewhere — the union of agents across the variant rows stays large.
    const rootEdit = results.filter((r) => /^root edit proposal review/i.test(r.title));
    expect(rootEdit.length).toBeGreaterThanOrEqual(2);
    const union = new Set(rootEdit.flatMap((r) => r.agents ?? []));
    expect(union.size).toBeGreaterThan(3);
  });

  it("includes the Root Edit Token Holder Vote duty for every agent copy ('triggers' verb)", () => {
    // Three real variants (SRC-review gate / >50% of votes cast excluding
    // abstentions / 50% in favor) — each keeps a row, no agent copy is dropped.
    const vote = results.filter((r) => /^root edit token holder vote/i.test(r.title));
    expect(vote.length).toBeGreaterThanOrEqual(2);
    const union = new Set(vote.flatMap((r) => r.agents ?? []));
    expect(union.size).toBeGreaterThan(6);
  });

  it("includes at least one assignment result", () => {
    expect(results.some((r) => r.category === "assignment")).toBe(true);
  });

  it("every duty row's facilitators resolve to real entity names", () => {
    const names = new Set(participants.map((p) => p.name));
    const bad = results
      .flatMap((r) => r.facilitators ?? [])
      .filter((n) => !names.has(n));
    expect(bad).toEqual([]);
  });
});
