// Tests for enumerateOeaTasks against the real built artifacts. Complements
// the synthetic-fixture tests in oeaTasks.test.ts.
// Run `pnpm build:index && pnpm build:graph` first if public/ is stale.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode, RelationEdge, GraphEntity } from "@/types";
import { enumerateOeaTasks } from "@/lib/oeaTasks";
import taskExclusions from "@/lib/data/oea-task-exclusions.json";

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

const tasks = enumerateOeaTasks(
  { docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: null },
  { participants, instances: [], invocations: [], primitives: [], edges: relations.edges },
);

describe("enumerateOeaTasks (real artifacts)", () => {
  it("finds a substantial task universe (~232 at time of writing)", () => {
    expect(tasks.length).toBeGreaterThan(150);
  });

  it("every task uuid resolves in docs.json", () => {
    expect(tasks.filter((t) => !docs[t.uuid])).toEqual([]);
  });

  it("has no duplicate taskKeys", () => {
    expect(new Set(tasks.map((t) => t.taskKey)).size).toBe(tasks.length);
  });

  it("covers all three sources and all five categories", () => {
    const sources = new Set(tasks.flatMap((t) => t.sources));
    expect(sources).toEqual(new Set(["govops", "facilitator", "executor"]));
    const cats = new Set(tasks.map((t) => t.category));
    expect(cats).toEqual(new Set(["op-duty", "universal", "assignment", "active-data", "process-step"]));
  });

  it("includes the rubric's calibration docs", () => {
    // e7fc7c2e Primitive Hub Document Update / 0bdcef8a Removal From Integrator
    // Program / e00e28d1 GovOps contracting-out. (76405733 is a definitional
    // posture doc the rubric rates weak — it enters via a duty_for edge.)
    for (const prefix of ["e7fc7c2e", "0bdcef8a", "e00e28d1", "76405733"]) {
      expect(tasks.some((t) => t.uuid.startsWith(prefix))).toBe(true);
    }
  });

  it("never emits an empty title or assessedText", () => {
    expect(tasks.filter((t) => !t.title?.trim())).toEqual([]);
    expect(tasks.filter((t) => !t.assessedText?.trim() && t.category !== "assignment")).toEqual([]);
  });

  it("marks some process-steps [automated] and most duty rows quoted", () => {
    expect(tasks.some((t) => t.automated)).toBe(true);
    const quoted = tasks.filter((t) => t.quoted).length;
    expect(quoted).toBeGreaterThan(tasks.length / 2);
  });

  it("never surfaces a confirmed non-task from oea-task-exclusions.json", () => {
    // Regression guard, same idea as dutyKnownExclusions.artifact.test.ts: a
    // future change to the underlying derives/graph-duties.mjs shouldn't
    // silently un-exclude a doc a human already reviewed and rejected.
    for (const entry of taskExclusions) {
      const bad = tasks.filter(
        (t) => t.uuid === entry.uuid && (entry.source === "any" || t.sources.includes(entry.source as never)),
      );
      expect(bad, `${entry.docNo} (${entry.source}) should stay excluded`).toEqual([]);
    }
  });
});
