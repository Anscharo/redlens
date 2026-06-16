// Tests for deriveResponsibilities against the real built artifacts.
// Run `pnpm build:index && pnpm build:graph` first if public/ is stale.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode, RelationEdge, GraphEntity } from "../types";
import { deriveResponsibilities, CATEGORY_LABELS } from "./facilitatorResponsibilities";

const ROOT = path.resolve(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");

const docs: Record<string, AtlasNode> = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8"),
).nodes;
const relations: { entities: GraphEntity[]; edges: RelationEdge[] } = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8"),
);

const byParent = new Map<string, AtlasNode[]>();
const docNoToId = new Map<string, string>();
for (const node of Object.values(docs)) {
  docNoToId.set(node.doc_no, node.id);
  if (node.parentId) {
    if (!byParent.has(node.parentId)) byParent.set(node.parentId, []);
    byParent.get(node.parentId)!.push(node);
  }
}

const participants = relations.entities.filter(
  (e) => e.et !== "instance" && e.et !== "invocation" && e.et !== "primitive",
);
const instances = relations.entities.filter((e) => e.et === "instance");
const invocations = relations.entities.filter((e) => e.et === "invocation");
const primitives = relations.entities.filter((e) => e.et === "primitive");

const results = deriveResponsibilities(
  { docs, byParent, docNoToId, atlasCommit: null },
  { participants, instances, invocations, primitives, edges: relations.edges },
);

const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

describe("deriveResponsibilities", () => {
  it("returns at least one result", () => {
    expect(results.length).toBeGreaterThan(0);
  });

  it("every result uuid exists in docs.json", () => {
    const missing = results.filter((r) => !docs[r.uuid]);
    expect(missing).toEqual([]);
  });

  it("every result has a valid category", () => {
    const invalid = results.filter((r) => !VALID_CATEGORIES.has(r.category));
    expect(invalid).toEqual([]);
  });

  it("every result has a non-empty duty snippet", () => {
    const empty = results.filter((r) => !r.duty?.trim());
    expect(empty).toEqual([]);
  });

  it("every result has a non-empty title", () => {
    const empty = results.filter((r) => !r.title?.trim());
    expect(empty).toEqual([]);
  });

  it("includes at least one universal duty", () => {
    expect(results.some((r) => r.category === "universal")).toBe(true);
  });

  it("includes at least one core-facilitator duty", () => {
    expect(results.some((r) => r.category === "core-facilitator")).toBe(true);
  });

  it("includes at least one root-edit duty", () => {
    expect(results.some((r) => r.category === "root-edit")).toBe(true);
  });

  it("includes at least one artifact-edit duty", () => {
    expect(results.some((r) => r.category === "artifact-edit")).toBe(true);
  });

  it("no duplicate uuids in results", () => {
    const seen = new Set<string>();
    const dupes = results.filter((r) => {
      if (seen.has(r.uuid)) return true;
      seen.add(r.uuid);
      return false;
    });
    expect(dupes).toEqual([]);
  });

  it("root-edit and artifact-edit results each have an agent field", () => {
    const withoutAgent = results.filter(
      (r) =>
        (r.category === "root-edit" || r.category === "artifact-edit") &&
        !r.agent,
    );
    expect(withoutAgent).toEqual([]);
  });

  it("active-data results all link to A.6.1.1 subtree", () => {
    const bad = results.filter(
      (r) => r.category === "active-data" && !r.docNo.startsWith("A.6.1.1."),
    );
    expect(bad).toEqual([]);
  });
});
