// Tests for deriveGovOpsResponsibilities against the real built artifacts.
// Complements the synthetic-fixture tests in govopsResponsibilities.test.ts —
// those exercise discovery/classification/dedup logic in isolation; these catch
// anything that only shows up against real docs.json/relations.json shapes.
// Run `pnpm build:index && pnpm build:graph` first if public/ is stale.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode, RelationEdge, GraphEntity } from "@/types";
import { deriveGovOpsResponsibilities, CATEGORY_LABELS } from "@/lib/govopsResponsibilities";

const ROOT = path.resolve(__dirname, "../../../..");
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
  { docs },
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

  it("a uuid appears in at most a core-duty + op-duty pair, never 3+ categories or any other combo", () => {
    // A doc can genuinely task both Core and Operational GovOps (e.g. a "Sky
    // Governance path / Independent Governance path" branch) — that's the
    // ONE legitimate way a uuid spans two rows. Anything else (3+ categories,
    // or a pairing outside {core-duty, op-duty}) would mean seenDocIds
    // priority broke down.
    const byUuid = new Map<string, Set<string>>();
    for (const r of results) {
      if (!byUuid.has(r.uuid)) byUuid.set(r.uuid, new Set());
      byUuid.get(r.uuid)!.add(r.category);
    }
    const multi = [...byUuid.entries()].filter(([, cats]) => cats.size > 1);
    const invalid = multi.filter(
      ([, cats]) => cats.size !== 2 || !cats.has("core-duty") || !cats.has("op-duty"),
    );
    expect(invalid).toEqual([]);
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
    // Ethereum SkyLink Freezer Multisig Modification (doc_no A.4.2.2.1.5, renumbered
    // from A.1.10.4.1.1.5). Assert the stable UUID — doc_nos are editorial and drift.
    expect(results.some((r) => r.uuid === "af5b97be-bf52-431d-8fa9-9b1c6164e328")).toBe(true);
  });

  it("does not collapse same-title agent-artifact duties whose text genuinely differs", () => {
    // "Modification" recurs under every agent artifact. Spark's doc
    // (31c59017…, A.6.1.1.1.2.6.1.2.1.2.2.2.5 — Core Operator Relayer Multisig)
    // and Skybase's (665ca5c5…, A.6.1.1.4.3.4.2.5 — USDS Demand Subsidies
    // Multisig) are DIFFERENT duties: bare-title collapse used to swallow
    // Skybase's row and misattribute its agent to Spark's doc.
    const spark = results.find((r) => r.uuid === "31c59017-769f-4a5b-88f7-8bef200dcc71");
    const skybase = results.find((r) => r.uuid === "665ca5c5-ca1b-471a-9a10-16c46ee10cfd");
    expect(spark).toBeDefined();
    expect(skybase).toBeDefined();
    expect(spark?.agents).not.toContain("Skybase");
  });

  it("does not silently collapse generic structural titles reused across unrelated primitives", () => {
    // "Process Flow" is reused by ~11 distinct Distribution Reward / Integration
    // Boost process-step docs outside the per-agent-artifact subtree — each must
    // keep its own row instead of being swallowed into one representative.
    const processFlowRows = results.filter((r) => r.title === "Process Flow");
    expect(processFlowRows.length).toBeGreaterThan(5);
  });
});
