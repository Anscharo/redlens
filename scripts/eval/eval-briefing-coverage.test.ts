import { describe, expect, it } from "bun:test";
import type { AtlasNode } from "../../src/types.ts";
import type { EmbedUnit } from "../../src/server/retrieval/embed-units.ts";
import { competingSets, fullyCovered } from "./eval-briefing-coverage.ts";
import type { RetrievalQuery } from "./eval-retrieval-queries.ts";

const node = (id: string, doc_no: string): AtlasNode =>
  ({ id, doc_no, title: id, parentId: null, content: "", type: "Core", depth: 1, order: 0, addressRefs: [] }) as unknown as AtlasNode;
const unit = (anchorId: string, memberIds = [anchorId]): EmbedUnit => ({ anchorId, memberIds, text: anchorId, hash: anchorId, family: "t" });
const query = (relevant: string[]): RetrievalQuery => ({ id: "q", slice: "control", query: "q", relevant }) as RetrievalQuery;

// A.1.1 is a grouped unit holding A.1.1.1 and A.1.1.2; A.1.2 and A.1.3 are units
// beside it; A.1.4 is a sibling with no unit of its own; A.2.1 is far away.
const docs = ["A.1.1", "A.1.1.1", "A.1.1.2", "A.1.2", "A.1.3", "A.1.4", "A.2.1"].map((d) => node(d, d));
const units = [unit("A.1.1", ["A.1.1", "A.1.1.1", "A.1.1.2"]), unit("A.1.2"), unit("A.1.3"), unit("A.2.1")];

describe("competingSets", () => {
  it("pulls in the units beside a grouped target and completes sibling sets", () => {
    const set = competingSets(docs, units, [query(["A.1.1.1"])]).get("q")!;
    expect([...set].sort()).toEqual(["A.1.1", "A.1.1.1", "A.1.1.2", "A.1.2", "A.1.3", "A.1.4"]);
    expect(set.has("A.2.1")).toBe(false);
  });

  it("gives a target with no unit an empty set", () => {
    expect(competingSets(docs, units, [query(["missing"])]).get("q")!.size).toBe(0);
  });
});

describe("fullyCovered", () => {
  const set = new Set(["A.1.1", "A.1.2"]);
  it("is true when every competitor has a briefing", () => {
    expect(fullyCovered(set, new Set(["A.1.1", "A.1.2", "other"]))).toBe(true);
  });
  it("is false when one competitor lacks a briefing", () => {
    expect(fullyCovered(set, new Set(["A.1.1"]))).toBe(false);
  });
  it("is false for an empty or missing competing set", () => {
    expect(fullyCovered(new Set(), new Set(["A.1.1"]))).toBe(false);
    expect(fullyCovered(undefined, new Set(["A.1.1"]))).toBe(false);
  });
});
