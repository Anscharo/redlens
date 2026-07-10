// Tests for buildLookup — the alias-flattening step that powers glossary highlighting.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildLookup, type Glossary } from "./glossary";

const entry = (term: string) => ({
  term,
  content: "definition",
  nodeId: "00000000-0000-0000-0000-000000000001",
  docNo: "A.0.1",
  sourceDocNo: "A.0.1",
  sourceContext: null,
});

describe("buildLookup", () => {
  it("keys a plain term by its lowercase form", () => {
    const g: Glossary = { "sky protocol": [entry("Sky Protocol")] };
    const lookup = buildLookup(g);
    expect(lookup["sky protocol"]).toBeDefined();
  });

  it("expands 'Term (Alias)' into three keys: full, base, and alias", () => {
    const g: Glossary = {
      "accessibility scope (acc)": [entry("Accessibility Scope (ACC)")],
    };
    const lookup = buildLookup(g);
    expect(lookup["accessibility scope (acc)"]).toBeDefined();
    expect(lookup["accessibility scope"]).toBeDefined();
    expect(lookup["acc"]).toBeDefined();
  });

  it("all three alias keys point to the same entries array", () => {
    const entries = [entry("Governance Scope (GOV)")];
    const g: Glossary = { "governance scope (gov)": entries };
    const lookup = buildLookup(g);
    expect(lookup["governance scope (gov)"]).toBe(lookup["governance scope"]);
    expect(lookup["governance scope"]).toBe(lookup["gov"]);
  });

  it("first-registered key wins — duplicate keys do not overwrite", () => {
    const first = [entry("Sky")];
    const second = [entry("Sky")];
    const g: Glossary = { sky: first, SKY: second };
    const lookup = buildLookup(g);
    expect(lookup["sky"]).toBe(first);
  });

  it("returns an empty object for an empty glossary", () => {
    expect(buildLookup({})).toEqual({});
  });

  it("handles a term with no parenthetical alias without error", () => {
    const g: Glossary = { "aligned delegate": [entry("Aligned Delegate")] };
    const lookup = buildLookup(g);
    expect(lookup["aligned delegate"]).toBeDefined();
    expect(Object.keys(lookup)).toHaveLength(1);
  });
});

// loadGlossary — a JSON-bodied 4xx/5xx must not be cached as the glossary
// (deep review finding: raw fetch() + r.json() had no res.ok check, unlike
// the sibling loaders which route through fetchJson).
describe("loadGlossary", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("does not cache a 404's JSON error body as the glossary — retries next call", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: "not found" }),
      } as Response;
    });

    const { loadGlossary } = await import("./glossary");
    await expect(loadGlossary("/base/")).rejects.toThrow();
    expect(calls).toBe(1);

    // A second call retries instead of reusing a cached rejection/error body.
    await expect(loadGlossary("/base/")).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("resolves normally on a 2xx response and caches the result", async () => {
    let calls = 0;
    const terms: Glossary = { sky: [entry("Sky")] };
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ atlasCommit: null, terms }) } as Response;
    });

    const { loadGlossary } = await import("./glossary");
    const first = await loadGlossary("/base2/");
    const second = await loadGlossary("/base2/");
    expect(first).toEqual(terms);
    expect(second).toBe(first);
    expect(calls).toBe(1);
  });
});
