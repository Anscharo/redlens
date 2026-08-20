import { describe, it, expect } from "vitest";
import type { AtlasNode } from "@/types";
import type { AtlasBundle } from "@/lib/docsTypes";
import {
  buildDocRefResolver,
  truncateTitle,
  refLabel,
  refTooltip,
  DOC_NO_RE,
  FULL_UUID_RE,
  SHORT_UUID_RE,
} from "./docRefResolver";

let order = 0;
const mk = (id: string, doc_no: string, title: string): AtlasNode => ({
  id,
  doc_no,
  title,
  type: "Core",
  depth: 1,
  parentId: null,
  content: "x",
  order: order++,
  addressRefs: [],
});

function bundleFrom(nodes: AtlasNode[]): AtlasBundle {
  const docs: Record<string, AtlasNode> = {};
  const docNoToId = new Map<string, string>();
  for (const n of nodes) {
    docs[n.id] = n;
    docNoToId.set(n.doc_no, n.id);
  }
  return { docs, docNoToId, byParent: new Map(), atlasCommit: null };
}

describe("truncateTitle / refLabel / refTooltip", () => {
  it("leaves a short title untouched", () => {
    expect(truncateTitle("Short Title")).toBe("Short Title");
  });

  it("truncates a long title to ~38 chars with an ellipsis", () => {
    const long = "A Very Long Document Title That Definitely Exceeds The Limit";
    const t = truncateTitle(long);
    expect(t.length).toBe(38);
    expect(t.endsWith("…")).toBe(true);
  });

  it("formats the label as DOC_NO • Truncated Title and the tooltip as DOC_NO - Title (untruncated)", () => {
    const long = "A Very Long Document Title That Definitely Exceeds The Limit";
    const node = mk("id-1", "A.9.9.9.9.9.9.9.9.9.9.9.9.9.9.9.9.9", long);
    expect(refLabel(node)).toBe(`${node.doc_no} • ${truncateTitle(long)}`);
    expect(refTooltip(node)).toBe(`${node.doc_no} - ${long}`);
  });
});

describe("regex forms", () => {
  it("matches a full uuid", () => {
    expect(FULL_UUID_RE.test("55999acf-75fe-4adf-8584-9746ef50d3e4")).toBe(true);
    expect(FULL_UUID_RE.test("55999acf")).toBe(false);
  });

  it("matches an 8-hex short pointer only", () => {
    expect(SHORT_UUID_RE.test("55999acf")).toBe(true);
    expect(SHORT_UUID_RE.test("55999ac")).toBe(false);
    expect(SHORT_UUID_RE.test("55999acf-75fe")).toBe(false);
  });

  it("matches bare doc_nos including structural suffixes, stopping before trailing punctuation", () => {
    const text = "See A.3.2.2.1, or /A.1.12.2.6 and (A.1.5.5.0.4.1.1.1.var1); also NR-8.";
    const matches = [...text.matchAll(DOC_NO_RE)].map((m) => m[0]);
    expect(matches).toEqual(["A.3.2.2.1", "A.1.12.2.6", "A.1.5.5.0.4.1.1.1.var1", "NR-8"]);
  });

  it("does not match a bare letter or unrelated word", () => {
    expect([..."A group of documents.".matchAll(DOC_NO_RE)]).toHaveLength(0);
  });
});

describe("buildDocRefResolver", () => {
  const FULL = "55999acf-75fe-4adf-8584-9746ef50d3e4";
  const AMBIG_A = "aaaaaaaa-0000-0000-0000-000000000001";
  const AMBIG_B = "aaaaaaaa-1111-1111-1111-111111111111";
  const resolver = buildDocRefResolver(
    bundleFrom([
      mk(FULL, "A.3.2", "Stability Fee Mechanics"),
      mk(AMBIG_A, "A.5.1", "First Ambiguous"),
      mk(AMBIG_B, "A.5.2", "Second Ambiguous"),
    ]),
  );

  it("resolves a full uuid", () => {
    expect(resolver.resolveFullUuid(FULL)?.doc_no).toBe("A.3.2");
  });

  it("resolves an unambiguous short uuid prefix", () => {
    expect(resolver.resolveShortUuid("55999acf")?.doc_no).toBe("A.3.2");
  });

  it("leaves an ambiguous short uuid prefix unresolved", () => {
    expect(resolver.resolveShortUuid("aaaaaaaa")).toBeUndefined();
  });

  it("resolves a bare doc_no", () => {
    expect(resolver.resolveDocNo("A.3.2")?.id).toBe(FULL);
  });

  it("leaves an unknown doc_no (e.g. renumbered atlas) unresolved rather than guessing", () => {
    expect(resolver.resolveDocNo("A.99.99")).toBeUndefined();
  });
});
