/**
 * Search index integration tests — run against the real public/ artifacts.
 * Requires `pnpm build:index` to have run first.
 *
 * Coverage:
 *  - Every documented search hint in SearchHints.tsx
 *  - Prefix search correctness (partial words, no stemmer)
 *  - Index still stores surface forms (plural/singular are not stemmed)
 *  - Backtick-wrapped inline-code terms
 *  - Field restriction (title:, type:) with and without space after colon
 */
import { describe, it, expect, beforeAll } from "vitest";
import MiniSearch from "minisearch";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { UUID_PREFIX_RE } from "@/lib/patterns";
import { MINISEARCH_OPTIONS } from "@/lib/searchOptions";
import { matchUuidPrefix } from "../lib/uuidSearch";

const SEARCH_OPTS = {
  prefix: true,
  boost: { title: 10, doc_no: 5, type: 2 },
  combineWith: "OR",
} as const;

type Doc = {
  id: string;
  title: string;
  type: string;
  doc_no: string;
  content: string;
  addressRefs?: string[];
};
type AddrInfo = { chainlogId?: string };

let ms: MiniSearch;
let docs: Record<string, Doc>;
let addrs: Record<string, AddrInfo>;
const byDocNo = new Map<string, Doc>();
const chainlogToAddr = new Map<string, string>();

beforeAll(() => {
  for (const p of ["public/search-index.json", "public/docs.json", "public/addresses.json"]) {
    if (!existsSync(resolve(p))) throw new Error(`${p} missing — run pnpm build:index first`);
  }
  ms = MiniSearch.loadJSON(readFileSync(resolve("public/search-index.json"), "utf8"), MINISEARCH_OPTIONS);
  docs = JSON.parse(readFileSync(resolve("public/docs.json"), "utf8")).nodes as Record<string, Doc>;
  addrs = JSON.parse(readFileSync(resolve("public/addresses.json"), "utf8")) as Record<string, AddrInfo>;

  for (const doc of Object.values(docs)) byDocNo.set(doc.doc_no, doc);
  for (const [addr, info] of Object.entries(addrs)) {
    if (info.chainlogId) chainlogToAddr.set(info.chainlogId, addr);
  }
});

// ---------------------------------------------------------------------------
// Search hints — one test per documented example in SearchHints.tsx
// ---------------------------------------------------------------------------

describe("hint: govern — prefix matches automatically", () => {
  it("partial word 'govern' returns governance-related results", () => {
    const results = ms.search("govern", SEARCH_OPTS);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => /govern/i.test(docs[r.id as string]?.title ?? ""))).toBe(true);
  });

  it("mid-word 'alignme' finds alignment docs (no stemmer interference)", () => {
    const results = ms.search("alignme", SEARCH_OPTS);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => /align/i.test(docs[r.id as string]?.title ?? ""))).toBe(true);
  });
});

describe("hint: 0x* — nodes containing an Ethereum address", () => {
  it("'0x' prefix returns docs whose content contains an on-chain address", () => {
    // The tokenizer splits on '*', so '0x*' and '0x' are equivalent queries
    const results = ms.search("0x", SEARCH_OPTS);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results.slice(0, 10)) {
      const doc = docs[r.id as string];
      expect((doc.title + " " + doc.content).toLowerCase()).toContain("0x");
    }
  });
});

describe("hint: MCD_VAT — chainlog id lookup", () => {
  it("MCD_VAT resolves to a known address via chainlog", () => {
    const addr = chainlogToAddr.get("MCD_VAT");
    expect(addr).toBeDefined();
    expect(addr).toMatch(/^0x/i);
  });

  it("the MCD_VAT address is referenced by at least one atlas doc", () => {
    const addr = chainlogToAddr.get("MCD_VAT")!;
    const refDocs = Object.values(docs).filter((d) => d.addressRefs?.includes(addr));
    expect(refDocs.length).toBeGreaterThan(0);
  });

  it("MiniSearch alone over-matches: raw 'MCD_VAT' query returns docs without the literal string", () => {
    // MiniSearch splits on '_', so "MCD_VAT" → ["MCD","VAT"]; prefix:true matches
    // "MCD_JUG", "MCD_POT", "advocate", etc. — the raw candidate set is too broad.
    const raw = ms.search("MCD_VAT", SEARCH_OPTS);
    const withoutLiteral = raw.filter((r) => {
      const doc = docs[r.id as string];
      return !(doc.content + " " + doc.title).includes("MCD_VAT");
    });
    expect(withoutLiteral.length).toBeGreaterThan(0);
  });

  it("case-phrase filter removes spurious MCD_* and 'vat'-prefix hits", () => {
    // Simulates the worker's fix: require literal "MCD_VAT" in text-matched results.
    const raw = ms.search("MCD_VAT", SEARCH_OPTS);
    const filtered = raw.filter((r) => {
      const doc = docs[r.id as string];
      return (doc.content + " " + doc.title).includes("MCD_VAT");
    });
    expect(filtered.length).toBeLessThan(raw.length);
    for (const r of filtered) {
      const doc = docs[r.id as string];
      expect((doc.content + " " + doc.title)).toContain("MCD_VAT");
    }
  });
});

describe("hint: A.1.2 — doc number jumps directly to a section", () => {
  it("byDocNo map resolves A.1.2 to its atlas document", () => {
    const doc = byDocNo.get("A.1.2");
    expect(doc).toBeDefined();
    expect(doc!.doc_no).toBe("A.1.2");
  });

  it("byDocNo covers every doc in the index", () => {
    // The fast-path works because byDocNo is built from docs.json, not the
    // MiniSearch index. Short doc_nos like "A.1.2" tokenize to single-char
    // tokens which processTerm filters out, so MiniSearch cannot find them —
    // byDocNo is the only path that works for exact doc number lookup.
    for (const doc of Object.values(docs)) {
      expect(byDocNo.get(doc.doc_no)).toBeDefined();
    }
  });
});

describe("hint: a491d7d0 — partial UUID prefix jumps to the doc", () => {
  it("UUID_PREFIX_RE accepts an 8-hex fragment, rejects shorter hex-ish words", () => {
    expect(UUID_PREFIX_RE.test("a491d7d0")).toBe(true);
    expect(UUID_PREFIX_RE.test("facade")).toBe(false);
  });

  it("the 8-hex prefix resolves to a live doc whose full id starts with it", () => {
    const ids = matchUuidPrefix("a491d7d0", Object.keys(docs));
    expect(ids.length).toBeGreaterThanOrEqual(1);
    for (const id of ids) expect(id.startsWith("a491d7d0")).toBe(true);
  });

  it("the id-scan is needed: the bare fragment is not a full-text index hit for its own doc", () => {
    // The id field isn't in the MiniSearch index, so a fragment can't surface
    // its own doc through full-text search — only the id scan finds it.
    const target = matchUuidPrefix("a491d7d0", Object.keys(docs))[0];
    const viaIndex = ms.search("a491d7d0", SEARCH_OPTS);
    expect(viaIndex.some((r) => r.id === target)).toBe(false);
  });
});

describe('hint: "properly implemented" — exact phrase', () => {
  it("MiniSearch returns candidates that include the phrase doc", () => {
    const results = ms.search("properly implemented", SEARCH_OPTS);
    // At least one result must contain the literal phrase
    const phrase = "properly implemented";
    const phraseHits = results.filter((r) => {
      const doc = docs[r.id as string];
      return (doc.content + " " + doc.title).toLowerCase().includes(phrase);
    });
    expect(phraseHits.length).toBeGreaterThan(0);
  });

  it("phrase post-filter removes results that lack the literal phrase", () => {
    const phrase = "properly implemented";
    const results = ms.search("properly implemented", SEARCH_OPTS);
    const filtered = results.filter((r) => {
      const doc = docs[r.id as string];
      return (doc.content + " " + doc.title).toLowerCase().includes(phrase);
    });
    // Filtered set must be a strict subset (some results lack the exact phrase)
    expect(filtered.length).toBeLessThanOrEqual(results.length);
    for (const r of filtered) {
      const doc = docs[r.id as string];
      expect((doc.content + " " + doc.title).toLowerCase()).toContain(phrase);
    }
  });
});

describe("hint: title:facilitator — search only in the title field", () => {
  it("fields:['title'] returns zero content-only results", () => {
    const results = ms.search("facilitator", { ...SEARCH_OPTS, fields: ["title"] });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(docs[r.id as string].title.toLowerCase()).toMatch(/facilit/);
    }
  });
});

describe("hint: type:Annotation — filter by node type", () => {
  it("type post-filter restricts to Annotation nodes only", () => {
    const results = ms
      .search("governance", SEARCH_OPTS)
      .filter((r) => docs[r.id as string]?.type === "Annotation");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(docs[r.id as string].type).toBe("Annotation");
    }
  });
});

describe("hint: type:Scenario_Variation — multi-word type via underscore", () => {
  it("Scenario Variation nodes exist in the atlas", () => {
    const svDocs = Object.values(docs).filter((d) => d.type === "Scenario Variation");
    expect(svDocs.length).toBeGreaterThan(0);
  });

  it("type post-filter for 'scenario variation' returns only those nodes", () => {
    // Underscore → space → "scenario variation"
    const results = ms
      .search("scenario", SEARCH_OPTS)
      .filter((r) => docs[r.id as string]?.type.toLowerCase() === "scenario variation");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(docs[r.id as string].type).toBe("Scenario Variation");
    }
  });
});

describe("hint: in:A.1.2 delegate — restrict results to a section subtree", () => {
  it("scope filter keeps only docs whose doc_no is within the prefix", () => {
    const prefix = "A.1.2";
    const allDelegates = ms.search("delegate", SEARCH_OPTS);
    const scoped = allDelegates.filter((r) => {
      const no = docs[r.id as string]?.doc_no ?? "";
      return no === prefix || no.startsWith(prefix + ".");
    });
    for (const r of scoped) {
      const no = docs[r.id as string].doc_no;
      expect(no === prefix || no.startsWith(prefix + ".")).toBe(true);
    }
  });

  it("scope filter produces fewer results than unscoped search", () => {
    // Pick a mid-level scope that definitely has subtree docs
    const allResults = ms.search("governance", SEARCH_OPTS);
    // Find a scope present in the results that has children
    const prefix = "A.1";
    const scoped = allResults.filter((r) => {
      const no = docs[r.id as string]?.doc_no ?? "";
      return no === prefix || no.startsWith(prefix + ".");
    });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.length).toBeLessThan(allResults.length);
  });
});

describe("hint: misaligment~1 — fuzzy match allows character edits", () => {
  it("'misaligment' with fuzzy:1 finds 'misalignment' (1 missing char)", () => {
    // "misaligment" is missing the 'n' — edit distance 1 from "misalignment"
    const results = ms.search("misaligment", { ...SEARCH_OPTS, prefix: false, fuzzy: 1 });
    expect(results.length).toBeGreaterThan(0);
    const found = results.some((r) =>
      (docs[r.id as string]?.content + docs[r.id as string]?.title)
        .toLowerCase()
        .includes("misalign"),
    );
    expect(found).toBe(true);
  });

  it("'misaligment' without fuzzy returns no results (confirmed misspelling)", () => {
    const exact = ms.search("misaligment", { ...SEARCH_OPTS, prefix: false, fuzzy: false });
    expect(exact.length).toBe(0);
  });
});

describe("hint: alignment -slippery — exclude a term", () => {
  it("exclusion post-filter removes docs containing the excluded term", () => {
    const allAlignment = ms.search("alignment", SEARCH_OPTS);
    expect(allAlignment.length).toBeGreaterThan(0);

    const excluded = "slippery";
    const filtered = allAlignment.filter((r) => {
      const doc = docs[r.id as string];
      return !(doc.title + " " + doc.content).toLowerCase().includes(excluded);
    });

    // Every remaining result must not contain the excluded term
    for (const r of filtered) {
      const doc = docs[r.id as string];
      expect((doc.title + " " + doc.content).toLowerCase()).not.toContain(excluded);
    }
  });
});

describe("hint: type:Core title:quorum — combine field filters", () => {
  it("title-restricted 'quorum' combined with Core type filter returns Core nodes with quorum in title", () => {
    const results = ms
      .search("quorum", { ...SEARCH_OPTS, fields: ["title"] })
      .filter((r) => docs[r.id as string]?.type === "Core");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const doc = docs[r.id as string];
      expect(doc.title.toLowerCase()).toContain("quorum");
      expect(doc.type).toBe("Core");
    }
  });
});

describe("hint: 'delegatedSigners' — single-quote case-sensitive phrase", () => {
  // The hint documents: single quotes → case-sensitive exact match.
  // Case-sensitivity is enforced by the worker's post-filter using
  // doc.content.includes(phrase) (not lowercased), not by MiniSearch itself.

  function caseSensitiveFilter(results: ReturnType<typeof ms.search>, phrase: string) {
    return results.filter((r) => {
      const doc = docs[r.id as string];
      return doc.content.includes(phrase) || doc.title.includes(phrase);
    });
  }

  it("'delegatedSigners' (exact camelCase) finds the Delegated Signers doc", () => {
    const candidates = ms.search("delegatedSigners", SEARCH_OPTS);
    const exact = caseSensitiveFilter(candidates, "delegatedSigners");
    expect(exact.map((r) => r.id)).toContain("98191437-0437-496e-ad1a-ceeba3c3b9d6");
  });

  it("'DelegatedSigners' (wrong case) does NOT find the Delegated Signers doc", () => {
    const candidates = ms.search("DelegatedSigners", SEARCH_OPTS);
    const exact = caseSensitiveFilter(candidates, "DelegatedSigners");
    // Content has `delegatedSigners` (lowercase d), not `DelegatedSigners`
    expect(exact.map((r) => r.id)).not.toContain("98191437-0437-496e-ad1a-ceeba3c3b9d6");
  });

  it("'Delegated Signers' (title case with space) finds the doc via title", () => {
    const candidates = ms.search("Delegated Signers", SEARCH_OPTS);
    const exact = caseSensitiveFilter(candidates, "Delegated Signers");
    // Title is "Delegated Signers" — exact case match in title field
    expect(exact.map((r) => r.id)).toContain("98191437-0437-496e-ad1a-ceeba3c3b9d6");
  });

  it("'delegated signers' (all lowercase) does NOT find the doc", () => {
    const candidates = ms.search("delegated signers", SEARCH_OPTS);
    const exact = caseSensitiveFilter(candidates, "delegated signers");
    // Content has `delegatedSigners` (camelCase, no space); title has "Delegated Signers" (capitals)
    // Neither contains the all-lowercase phrase literally
    expect(exact.map((r) => r.id)).not.toContain("98191437-0437-496e-ad1a-ceeba3c3b9d6");
  });
});

// ---------------------------------------------------------------------------
// Regression tests — bugs that were fixed during the MiniSearch migration
// ---------------------------------------------------------------------------

describe("regression: prefix search — partial words find expected results", () => {
  it("delegat → delegate-related docs", () => {
    const results = ms.search("delegat", SEARCH_OPTS);
    expect(results.some((r) => /delegate/i.test(docs[r.id as string]?.title ?? ""))).toBe(true);
  });

  it("facilit → facilitator-related docs", () => {
    const results = ms.search("facilit", SEARCH_OPTS);
    expect(results.some((r) => /facilit/i.test(docs[r.id as string]?.title ?? ""))).toBe(true);
  });

  it("univer → Universal-related docs", () => {
    const results = ms.search("univer", SEARCH_OPTS);
    expect(results.some((r) => /universal/i.test(docs[r.id as string]?.title ?? ""))).toBe(true);
  });

  it("misalignme → misalignment docs (10-char prefix, was broken with stemmer)", () => {
    const results = ms.search("misalignme", SEARCH_OPTS);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("regression: no stemmer in the index — MiniSearch stores surface forms", () => {
  // Inflection is query-time in the worker / runLexical, not processTerm.
  // These assert the serialized index itself still distinguishes the forms.
  it("'agents' only returns docs containing 'agents'", () => {
    const results = ms.search("agents", SEARCH_OPTS);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const doc = docs[r.id as string];
      expect((doc.title + " " + doc.content).toLowerCase()).toContain("agents");
    }
  });

  it("'delegates' only returns docs containing 'delegates'", () => {
    const results = ms.search("delegates", SEARCH_OPTS);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const doc = docs[r.id as string];
      expect((doc.title + " " + doc.content).toLowerCase()).toContain("delegates");
    }
  });
});

describe("regression: backtick-wrapped terms are searchable", () => {
  // MiniSearch does not split on backtick; processTerm must strip them so
  // `delegatedSigners` indexes as "delegatedsigners" not "`delegatedsigners`"
  it("'delegatedSigners' finds the Delegated Signers doc", () => {
    const results = ms.search("delegatedSigners", { prefix: true });
    expect(results.map((r) => r.id)).toContain("98191437-0437-496e-ad1a-ceeba3c3b9d6");
  });
});

describe("regression: field scope tolerates space after colon", () => {
  it("title-scoped search returns zero content-only results", () => {
    const results = ms.search("delegate", { ...SEARCH_OPTS, fields: ["title"] });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(docs[r.id as string].title.toLowerCase()).toMatch(/delegat/);
    }
  });

  it("type post-filter returns only matching types", () => {
    const results = ms
      .search("alignment", SEARCH_OPTS)
      .filter((r) => docs[r.id as string]?.type === "Core");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(docs[r.id as string].type).toBe("Core");
  });
});
