// The one rule for a prime's rate-limit value sources, read through both entity
// shapes: a server or graph.json row and a relations.json entity give the same
// sources for the same entities, so the chat, the census, the reader and the
// Radar page compare the same values.
import { describe, expect, it } from "vitest";
import type { GraphEntity } from "../types.ts";
import { graphView, primesStatingValues, primeValueSources, rowView, type SourceEntity } from "./pauPrimeSources.ts";

interface Fixture { id: string; type: string; doc: string | null; meta: object | string | null }
const FIXTURE: Fixture[] = [
  { id: "prime", type: "agent", doc: "prime-doc", meta: { params: { "USDS Mint RateLimitID": ["0x1", "prime-doc"] } } },
  { id: "i1", type: "instance", doc: "i1-doc", meta: { agent_doc_id: "prime", params: { "Inflow Rate Limits / maxAmount": ["5", "i1-value"] } } },
  { id: "v1", type: "invocation", doc: "v1-doc", meta: { agent_doc_id: "prime", params: { "Outflow Rate Limits / slope": ["1", "v1-doc"] } } },
  { id: "p1", type: "primitive", doc: "p1-doc", meta: { agent_doc_id: "prime", params: { "Inflow Rate Limits / maxAmount": ["9", "p1-doc"] } } },
  { id: "i2", type: "instance", doc: "i2-doc", meta: { agent_doc_id: "other", params: { "Inflow Rate Limits / slope": ["2", "i2-doc"] } } },
  { id: "bad", type: "instance", doc: "bad-doc", meta: "{not json" },
];
const json = (m: Fixture["meta"]) => (m === null ? null : typeof m === "string" ? m : JSON.stringify(m));
const rows = FIXTURE.map((f): SourceEntity => ({ id: f.id, name: f.id, entity_type: f.type, defining_doc_id: f.doc, meta: json(f.meta) }));
const graph = FIXTURE.map((f): GraphEntity => ({ id: f.id, slug: f.id, name: f.id, et: f.type, st: null, did: f.doc, ...(f.meta === null ? {} : { m: json(f.meta)! }) }));

describe("primeValueSources", () => {
  it("gives the prime's own params, then every instance and invocation naming it, never a primitive", () => {
    expect(primeValueSources(rows.map(rowView), "prime").map((s) => [s.name, s.docId, Object.keys(s.params).length])).toEqual([["prime", null, 1], ["i1", "i1-doc", 1], ["v1", "v1-doc", 1]]);
  });
  it("gives the same sources whichever shape the entities came in", () => {
    for (const prime of ["prime", "other", "nobody"]) expect(primeValueSources(graph.map(graphView), prime)).toEqual(primeValueSources(rows.map(rowView), prime));
    expect(primesStatingValues(graph.map(graphView))).toEqual(primesStatingValues(rows.map(rowView)));
  });
  it("reads an unknown prime as nameless, and an unreadable meta as empty", () => {
    expect(primeValueSources(rows.map(rowView), "nobody")).toEqual([{ name: "", docId: null, params: {} }]);
    expect(rowView(rows.at(-1)!).meta).toEqual({});
  });
});

describe("primesStatingValues", () => {
  it("names each prime an instance states a maxAmount or slope for", () => {
    expect(primesStatingValues(rows.map(rowView)).sort()).toEqual(["other", "prime"]);
  });
});
