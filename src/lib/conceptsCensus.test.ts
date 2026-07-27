import { describe, expect, it } from "vitest";
import type { AtlasNode } from "../types";
import { computeConceptsCensus, hasDataTable } from "./conceptsCensus";

let order = 0;
const mk = (doc_no: string, title: string, type: string, content = "xx", id?: string): AtlasNode => ({
  id: id ?? `id-${doc_no}`,
  doc_no,
  title,
  type,
  depth: 1,
  parentId: null,
  content,
  order: order++,
  addressRefs: [],
});

const byId = (nodes: AtlasNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n]));

describe("hasDataTable", () => {
  it("requires at least one data row beyond the header + separator", () => {
    expect(hasDataTable("| a | b |\n|---|---|\n")).toBe(false); // header-only stub
    expect(hasDataTable("| a | b |\n|---|---|\n| 1 | 2 |\n")).toBe(true);
  });
});

describe("registry-liveness", () => {
  it("buckets a header-only-table registry and a bare pointer-sentence registry as empty", () => {
    const nodes = [
      mk("A.9.1", "List Of Empty Table Registry", "Active Data", "| a | b |\n|---|---|\n"),
      mk("A.9.2", "List Of Placeholder Registry", "Active Data", "The current Foos are:"),
    ];
    const out = computeConceptsCensus(byId(nodes));
    expect(out["registry-liveness"].counts).toEqual({ total: 2, live: 0, empty: 2 });
  });

  it("buckets a populated-table registry, a bulleted registry, and a registry with descendants as live", () => {
    const nodes = [
      mk("A.9.3", "List Of Populated Table Registry", "Active Data", "| a | b |\n|---|---|\n| 1 | 2 |\n"),
      mk("A.9.4", "List Of Bulleted Registry", "Active Data", "The Foos are:\n\n- Foo One\n- Foo Two"),
      mk("A.9.5", "List Of Structural Registry", "Core", "See below."),
      mk("A.9.5.1", "A Foo", "Core", "content"),
    ];
    const out = computeConceptsCensus(byId(nodes));
    expect(out["registry-liveness"].counts).toEqual({ total: 3, live: 3, empty: 0 });
  });

  it("ignores docs that don't carry the exact title prefix", () => {
    const nodes = [mk("A.9.6", "Listing Of Foos", "Core", "The Foos are:\n\n- Foo")];
    const out = computeConceptsCensus(byId(nodes));
    expect(out["registry-liveness"].counts.total).toBe(0);
  });
});

describe("empty-scaffolding", () => {
  it("flags an instance status directory with no descendants as empty", () => {
    const nodes = [mk("A.9.7", "Active Instances Directory", "Core", "x")];
    const out = computeConceptsCensus(byId(nodes));
    expect(out["empty-scaffolding"].counts).toEqual({ total: 1, empty: 1, populated: 0 });
  });

  it("does not flag a status directory that has a descendant instance", () => {
    const nodes = [
      mk("A.9.8", "Completed Invocations", "Core", "x"),
      mk("A.9.8.1", "An Invocation", "Core", "x"),
    ];
    const out = computeConceptsCensus(byId(nodes));
    expect(out["empty-scaffolding"].counts).toEqual({ total: 1, empty: 0, populated: 1 });
  });
});

describe("ghost-doc-types", () => {
  it("buckets a type-spec doc as used when its aliased name occurs as a real type: value", () => {
    const registryUuid = "428b7f2e-30b0-4119-a10a-9c3496f19bd2";
    const nodes = [
      mk("A.1.2.2.2", "List Of Document Types And Their Specifications", "Core", "x", registryUuid),
      mk("A.1.2.2.2.1", "The Scope Type", "Type Specification", "x"),
      mk("A.1.2.2.2.2", "The Facilitator Action Tenet Type", "Type Specification", "x"),
      mk("A.1.2.2.2.3", "The Budget Controller Type", "Type Specification", "x"),
      mk("A.9.9", "Some Scope Node", "Scope", "x"), // makes "Scope" an occurring type
      mk("A.9.10", "Some Action Tenet", "Action Tenet", "x"), // makes "Action Tenet" occurring
    ];
    const out = computeConceptsCensus(byId(nodes));
    const { members, counts } = out["ghost-doc-types"];
    expect(counts).toEqual({ total: 3, used: 2, ghost: 1 });
    expect(members.find((m) => m.title === "The Scope Type")?.bucket).toBe("used");
    expect(members.find((m) => m.title === "The Facilitator Action Tenet Type")?.bucket).toBe("used");
    expect(members.find((m) => m.title === "The Budget Controller Type")?.bucket).toBe("ghost");
  });
});

describe("transitionary-measures", () => {
  it("matches both singular and plural title forms", () => {
    const nodes = [
      mk("A.9.11", "Foo Transitionary Measure", "Core", "x"),
      mk("A.9.12", "Bar Transitionary Measures", "Core", "x"),
      mk("A.9.13", "Unrelated Doc", "Core", "x"),
    ];
    const out = computeConceptsCensus(byId(nodes));
    expect(out["transitionary-measures"].counts.total).toBe(2);
  });
});

describe("formula-docs", () => {
  it("matches the four LaTeX commands and tallies the A.3.2 subset", () => {
    const nodes = [
      mk("A.3.2.1", "Formula One", "Core", "$$\\frac{a}{b}$$"),
      mk("A.4.1", "Formula Two", "Core", "\\sum_{i} x_i"),
      mk("A.4.2", "Not A Formula", "Core", "plain prose, no math"),
    ];
    const out = computeConceptsCensus(byId(nodes));
    expect(out["formula-docs"].counts).toEqual({ total: 2, "A.3.2": 1 });
  });
});

describe("numbered-step-docs", () => {
  it("requires a 2. line after 1. with no other number in between", () => {
    const nodes = [
      mk("A.9.14", "Sequential", "Core", "1. First\n2. Second"),
      mk("A.9.15", "Skip", "Core", "1. First\n3. Third"), // no 2. — not a match
      mk("A.9.16", "OnlyOne", "Core", "1. Only step"),
    ];
    const out = computeConceptsCensus(byId(nodes));
    expect(out["numbered-step-docs"].counts.total).toBe(1);
  });
});

describe("prohibition-language", () => {
  it("matches any of the four prohibition phrasings", () => {
    const nodes = [
      mk("A.9.17", "A", "Core", "This action is prohibited."),
      mk("A.9.18", "B", "Core", "Kickbacks are forbidden."),
      mk("A.9.19", "C", "Core", "This is not permitted under any circumstance."),
      mk("A.9.20", "D", "Core", "The delegate may not hold two roles."),
      mk("A.9.21", "E", "Core", "This is completely unrestricted."),
    ];
    const out = computeConceptsCensus(byId(nodes));
    expect(out["prohibition-language"].counts.total).toBe(4);
  });
});

describe("title-templates", () => {
  it("counts exact title matches per curated family", () => {
    const nodes = [
      mk("A.9.22", "Parameters", "Core", "x"),
      mk("A.9.23", "Parameters", "Core", "x"),
      mk("A.9.24", "Parameters For Something Else", "Core", "x"), // not an exact match
      mk("A.9.25", "Omni Documents", "Core", "x"),
    ];
    const out = computeConceptsCensus(byId(nodes));
    const { counts } = out["title-templates"];
    expect(counts.Parameters).toBe(2);
    expect(counts["Omni Documents"]).toBe(1);
    expect(counts.total).toBe(3);
  });
});

describe("cross-scope-duplication", () => {
  it("pairs an identical title across two scopes when both copies are non-trivial", () => {
    const nodes = [
      mk("A.1.5.1", "SkyLink Freezer Multisig", "Core", "A".repeat(50)),
      mk("A.4.2.1", "SkyLink Freezer Multisig", "Core", "B".repeat(50)),
    ];
    const out = computeConceptsCensus(byId(nodes));
    expect(out["cross-scope-duplication"].counts).toEqual({ total: 2, groups: 1 });
  });

  it("excludes same-scope repeats, trivial-content copies, and >3-occurrence titles", () => {
    const nodes = [
      // same scope only — excluded
      mk("A.1.1.1", "Same Scope Repeat", "Core", "A".repeat(50)),
      mk("A.1.1.2", "Same Scope Repeat", "Core", "B".repeat(50)),
      // cross-scope but one copy trivial — excluded
      mk("A.1.2.1", "Thin Copy", "Core", "A".repeat(50)),
      mk("A.4.3.1", "Thin Copy", "Core", "short"),
      // cross-scope but occurs 4 times — excluded (> 3)
      mk("A.1.3.1", "Overused Title", "Core", "A".repeat(50)),
      mk("A.2.3.1", "Overused Title", "Core", "A".repeat(50)),
      mk("A.3.3.1", "Overused Title", "Core", "A".repeat(50)),
      mk("A.4.3.2", "Overused Title", "Core", "A".repeat(50)),
    ];
    const out = computeConceptsCensus(byId(nodes));
    expect(out["cross-scope-duplication"].counts).toEqual({ total: 0, groups: 0 });
  });
});
