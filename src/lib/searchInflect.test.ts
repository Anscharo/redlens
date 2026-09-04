import { describe, it, expect } from "vitest";
import pluralize from "pluralize";
import {
  counterpartTerm,
  expandQueryTokens,
  normalizeToken,
  partitionByOriginalTerms,
  resolvePluralize,
} from "./searchInflect";

describe("counterpartTerm", () => {
  it("maps subsidy ↔ subsidies (y/ies, neither is a prefix of the other)", () => {
    expect(counterpartTerm("subsidy")).toBe("subsidies");
    expect(counterpartTerm("subsidies")).toBe("subsidy");
  });

  it("maps entity ↔ entities and proxy ↔ proxies", () => {
    expect(counterpartTerm("entity")).toBe("entities");
    expect(counterpartTerm("entities")).toBe("entity");
    expect(counterpartTerm("proxy")).toBe("proxies");
    expect(counterpartTerm("proxies")).toBe("proxy");
  });

  it("maps person ↔ people (irregular)", () => {
    expect(counterpartTerm("person")).toBe("people");
    expect(counterpartTerm("people")).toBe("person");
  });

  it("maps leaf ↔ leaves (f/ves)", () => {
    expect(counterpartTerm("leaf")).toBe("leaves");
    expect(counterpartTerm("leaves")).toBe("leaf");
  });

  it("prefix-gates regular +s: agent does not expand; agents → agent", () => {
    expect(counterpartTerm("agent")).toBeNull();
    expect(counterpartTerm("agents")).toBe("agent");
    expect(counterpartTerm("day")).toBeNull();
    expect(counterpartTerm("days")).toBe("day");
  });

  it("does not inflect incomplete prefixes that would just grow by s", () => {
    expect(counterpartTerm("subsid")).toBeNull();
    expect(counterpartTerm("govern")).toBeNull();
  });

  it("leaves atlas uncountables and tickers alone", () => {
    expect(counterpartTerm("sky")).toBeNull();
    expect(counterpartTerm("skies")).toBeNull();
    expect(counterpartTerm("usds")).toBeNull();
    expect(counterpartTerm("USDS")).toBeNull();
    expect(counterpartTerm("MCD_VAT")).toBeNull();
    expect(counterpartTerm("sUSDS")).toBeNull();
  });

  it("skips short tokens, digits, doc numbers, and UUID fragments", () => {
    expect(counterpartTerm("or")).toBeNull();
    expect(counterpartTerm("a1")).toBeNull();
    expect(counterpartTerm("A.1.2")).toBeNull();
    expect(counterpartTerm("a491d7d0")).toBeNull();
  });

  it("strips leading/trailing punctuation before inflecting", () => {
    expect(counterpartTerm("subsidy,")).toBe("subsidies");
    expect(counterpartTerm("Subsidy.")).toBe("subsidies");
    expect(counterpartTerm("(entities)")).toBe("entity");
    expect(counterpartTerm("USDS,")).toBeNull();
  });
});

describe("resolvePluralize", () => {
  it("accepts the Node CJS function export and Vite's UMD `{ pluralize }` shape", () => {
    expect(resolvePluralize(pluralize).plural("subsidy")).toBe("subsidies");
    expect(resolvePluralize({ pluralize }).singular("subsidies")).toBe("subsidy");
    expect(resolvePluralize({ default: { pluralize } }).plural("entity")).toBe("entities");
  });

  it("throws on an empty CJS exports object (the Vite UMD miss)", () => {
    expect(() => resolvePluralize({})).toThrow(/unexpected module shape/);
    expect(() => resolvePluralize({ default: {} })).toThrow(/unexpected module shape/);
  });
});

describe("expandQueryTokens", () => {
  it("keeps originals and appends only the non-prefix counterpart", () => {
    expect(expandQueryTokens(["subsidy"])).toEqual({
      originals: ["subsidy"],
      extra: ["subsidies"],
      all: ["subsidy", "subsidies"],
    });
    expect(expandQueryTokens(["agent"])).toEqual({
      originals: ["agent"],
      extra: [],
      all: ["agent"],
    });
    expect(expandQueryTokens(["agents"])).toEqual({
      originals: ["agents"],
      extra: ["agent"],
      all: ["agents", "agent"],
    });
  });

  it("normalises case the way MiniSearch processTerm does", () => {
    expect(normalizeToken("Subsidy")).toBe("subsidy");
    expect(expandQueryTokens(["Subsidy"]).originals).toEqual(["subsidy"]);
  });
});

describe("partitionByOriginalTerms", () => {
  it("places original-term hits above inflection-only hits, preserving score order inside each bucket", () => {
    const hits = [
      { id: "b", score: 9, queryTerms: ["subsidies"] },
      { id: "a", score: 5, queryTerms: ["subsidy"] },
      { id: "c", score: 2, queryTerms: ["subsidies"] },
    ];
    expect(partitionByOriginalTerms(hits, new Set(["subsidy"])).map((h) => h.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("treats a prefix match of the original term as original, not inflection", () => {
    const hits = [{ id: "agents-doc", queryTerms: ["agent"] }];
    expect(partitionByOriginalTerms(hits, new Set(["agent"]))[0].id).toBe("agents-doc");
  });
});
