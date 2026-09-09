import { describe, it, expect } from "vitest";
import type { AtlasNode } from "@/types";
import { buildProcessRows, countSteps, processRowsToCSV, type ProcessEntry, type ProcessRow } from "./processesIndex";

function mkNode(
  id: string,
  doc_no: string,
  title: string,
  opts: { content?: string; type?: string; parentId?: string | null } = {},
): AtlasNode {
  return {
    id,
    doc_no,
    title,
    type: opts.type ?? "Core",
    depth: doc_no.split(".").length,
    parentId: opts.parentId ?? null,
    content: opts.content ?? "",
    contentHash: "",
    order: 0,
    addressRefs: [],
  };
}

describe("buildProcessRows", () => {
  const docs: Record<string, AtlasNode> = {
    // Process with doc_no-based children at depth cap (no parentId, no parent_of edge)
    p1: mkNode("p1", "A.2.2.1.2.4.1", "Stages"),
    p1c1: mkNode("p1c1", "A.2.2.1.2.4.1.1", "Stage 1"),
    p1c2: mkNode("p1c2", "A.2.2.1.2.4.1.2", "Stage 2"),
    p1c3: mkNode("p1c3", "A.2.2.1.2.4.1.3", "Stage 3"),
    // An annotation under .0 that must NOT be counted as a step
    p1ann: mkNode("p1ann", "A.2.2.1.2.4.1.0.3.1", "Some annotation", { type: "Annotation" }),
    // An inline process with parenthesized enumeration
    p2: mkNode("p2", "A.2.2.5.2.2.2", "Artifact Edit Process", {
      content: "Conditions: (1) approve, (2) review, (3) execute, (4) audit.",
    }),
    // Inline process with no enumeration — heuristic returns null
    p3: mkNode("p3", "A.2.2.9.1.1.1.1.1", "Designation Process", {
      content: "Designations are made by the Core Facilitator via forum post.",
    }),
  };

  const entries: ProcessEntry[] = [
    { uuid: "p1", category: "X", shape: "child", status: "active" },
    { uuid: "p2", category: "X", shape: "inline", status: "active" },
    { uuid: "p3", category: "X", shape: "inline", status: "active" },
    { uuid: "missing", category: "X", shape: "child", status: "active" },
  ];

  const rows = buildProcessRows(docs, entries);

  it("drops curated entries whose UUID is missing from docs", () => {
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.uuid === "missing")).toBeUndefined();
  });

  it("counts doc_no-based step children even when parentId is null (depth cap)", () => {
    const r = rows.find((r) => r.uuid === "p1")!;
    expect(r.stepCount).toBe(3);
  });

  it("excludes annotation children from step count", () => {
    // p1 has 3 step children + 1 annotation child; only steps count.
    const r = rows.find((r) => r.uuid === "p1")!;
    expect(r.stepCount).toBe(3);
  });

  it("counts parenthesized enumeration in inline content", () => {
    const r = rows.find((r) => r.uuid === "p2")!;
    expect(r.stepCount).toBe(4);
  });

  it("returns null when no step signal can be derived", () => {
    const r = rows.find((r) => r.uuid === "p3")!;
    expect(r.stepCount).toBeNull();
  });

  it("manual stepCount on the entry overrides the heuristic", () => {
    const overridden: ProcessEntry[] = [
      // p3 has no step signal in content; manual override gives it one.
      { uuid: "p3", category: "X", shape: "inline", status: "active", stepCount: 4 },
      // p1 has 3 doc_no children but we override to 5 (e.g. manual count includes prose steps).
      { uuid: "p1", category: "X", shape: "child", status: "active", stepCount: 5 },
    ];
    const out = buildProcessRows(docs, overridden);
    expect(out.find((r) => r.uuid === "p3")!.stepCount).toBe(4);
    expect(out.find((r) => r.uuid === "p1")!.stepCount).toBe(5);
  });
});

describe("countSteps heuristics", () => {
  const empty = new Map<string, AtlasNode[]>();

  it("counts Step N headings", () => {
    const n = mkNode("x", "A.1", "P", {
      content: "## Step 1 — Foo\n\n## Step 2 — Bar\n\n## Step 3 — Baz",
    });
    expect(countSteps(n, empty)).toBe(3);
  });

  it("counts numbered list items", () => {
    const n = mkNode("x", "A.1", "P", { content: "1. Do A\n2. Do B\n3. Do C\n4. Do D" });
    expect(countSteps(n, empty)).toBe(4);
  });

  it("requires sequential (1) (2) ... for parenthesized enumeration", () => {
    const skip = mkNode("x", "A.1", "P", { content: "see (1) and (5) and (3)" });
    expect(countSteps(skip, empty)).toBeNull();
  });

  it("counts bullets only when ≥ 3", () => {
    const two = mkNode("x", "A.1", "P", { content: "- a\n- b" });
    expect(countSteps(two, empty)).toBeNull();
    const three = mkNode("x", "A.1", "P", { content: "- a\n- b\n- c" });
    expect(countSteps(three, empty)).toBe(3);
  });
});

describe("processRowsToCSV", () => {
  const rows: ProcessRow[] = [
    { uuid: "u1", docNo: "A.1.1", title: "Onboard", category: "governance", shape: "child", status: "active", stepCount: 4 },
    { uuid: "u2", docNo: "A.2.1", title: "Prose flow", category: "risk", shape: "inline", status: "deferred-stub", stepCount: null },
  ];

  it("emits the header (incl. UUID/Atlas Link/Ignored) and renders a null step count as an empty cell", () => {
    const lines = processRowsToCSV(rows).split("\r\n");
    expect(lines[0]).toBe('"Doc No","Title","UUID","Atlas Link","Category","Shape","Status","Steps","Ignored"');
    expect(lines[1]).toBe('"A.1.1","Onboard","u1","/atlas?id=u1","governance","child","active","4",""');
    expect(lines[2]).toBe('"A.2.1","Prose flow","u2","/atlas?id=u2","risk","inline","deferred-stub","",""');
  });

  it("annotates the Ignored column with the ignore reason (or 'yes' when blank)", () => {
    const ignores = new Map([
      ["u1", { reason: "duplicate of A.9" }],
      ["u2", { reason: "" }],
    ]);
    const lines = processRowsToCSV(rows, ignores).split("\r\n");
    expect(lines[1]).toBe('"A.1.1","Onboard","u1","/atlas?id=u1","governance","child","active","4","duplicate of A.9"');
    expect(lines[2]).toBe('"A.2.1","Prose flow","u2","/atlas?id=u2","risk","inline","deferred-stub","","yes"');
  });
});
