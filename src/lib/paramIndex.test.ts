import { describe, expect, it } from "vitest";
import type { AtlasNode } from "../types";
import { buildParamIndex } from "./paramIndex";

let order = 0;
function mk(opts: {
  id: string;
  doc_no?: string;
  title: string;
  type?: string;
  content: string;
  parentId?: string | null;
  depth?: number;
}): AtlasNode {
  return {
    id: opts.id,
    doc_no: opts.doc_no ?? opts.id,
    title: opts.title,
    type: opts.type ?? "Core",
    depth: opts.depth ?? 6,
    parentId: opts.parentId ?? null,
    content: opts.content,
    order: order++,
    addressRefs: [],
  };
}
function map(nodes: AtlasNode[]): Map<string, AtlasNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

// ---------------------------------------------------------------------------
// kv pattern — the ground-truth shape (Keel/Spark/Grove "USDS Mint Maximum")
// ---------------------------------------------------------------------------
describe("kv pattern", () => {
  it("extracts maxAmount + slope from a rate-limit doc, with owner resolved through a generic container", () => {
    const scope = mk({ id: "scope", title: "The Agent Scope", type: "Scope", content: "x", depth: 1 });
    const artifacts = mk({ id: "artifacts", title: "Agent Artifacts", type: "Article", content: "x", parentId: "scope", depth: 2 });
    const listOf = mk({ id: "listof", title: "List Of Prime Agent Artifacts", type: "Section", content: "x", parentId: "artifacts", depth: 3 });
    const keel = mk({ id: "keel", title: "Keel", content: "x", parentId: "listof", depth: 4 });
    const primitives = mk({ id: "prim", title: "Sky Primitives", content: "x", parentId: "keel", depth: 5 });
    const mint = mk({
      id: "mint", doc_no: "A.6.1.1.3.2.6.1.2.1.1.3.1.1.1", title: "USDS Mint Maximum", parentId: "prim",
      content: "The maximum amount of USDS that can be minted within the Keel Liquidity Layer (`LIMIT_USDS_MINT`) is specified in the document herein.\n\n- `maxAmount`: 10,000 USDS\n- `slope`: 10,000 USDS per day",
    });
    const ix = buildParamIndex(map([scope, artifacts, listOf, keel, primitives, mint]));
    const rows = ix.byUuid.get("mint")!;
    expect(rows).toEqual([
      { uuid: "mint", doc_no: "A.6.1.1.3.2.6.1.2.1.1.3.1.1.1", name: "maxamount", value: "10,000 USDS", num: 10000, unit: "USDS", owner: "keel", context: "- `maxAmount`: 10,000 USDS", source: "kv" },
      { uuid: "mint", doc_no: "A.6.1.1.3.2.6.1.2.1.1.3.1.1.1", name: "slope", value: "10,000 USDS per day", num: 10000, unit: "USDS per day", owner: "keel", context: "- `slope`: 10,000 USDS per day", source: "kv" },
    ]);
  });

  it("reads a kv line whose VALUE is backticked, not just its key", () => {
    const n = mk({ id: "n", title: "ETH-C", content: "- `tip`: `250`\n" });
    const ix = buildParamIndex(map([n]));
    const tip = ix.rows.find((r) => r.name === "tip")!;
    expect(tip.value).toBe("250");
    expect(tip.num).toBe(250);
    // `context` keeps the line exactly as the atlas wrote it, backticks included.
    expect(tip.context).toBe("- `tip`: `250`");
  });

  it("a backticked value with a trailing parenthetical still parses", () => {
    const n = mk({ id: "n", title: "Vault", content: "- Initial LTV: `80%` (125% collateralization ratio)\n" });
    const ix = buildParamIndex(map([n]));
    const ltv = ix.rows.find((r) => r.name === "initial ltv")!;
    expect(ltv.value).toBe("80%");
    expect(ltv.num).toBe(80);
  });

  it("a backticked NON-value is still rejected — unwrapping widens nothing", () => {
    const n = mk({ id: "n", title: "Pending", content: "- Address: `TBD`\n- Owner: `0xabc`\n" });
    expect(buildParamIndex(map([n])).rows).toEqual([]);
  });

  it("does not swallow a trailing list-item comma into the number", () => {
    const n = mk({ id: "n", title: "ETH-B", content: "- `tip`: 250,\n- `chop`: 13%,\n" });
    const ix = buildParamIndex(map([n]));
    const tip = ix.rows.find((r) => r.name === "tip")!;
    expect(tip.value).toBe("250");
    expect(tip.num).toBe(250);
    expect(tip.unit).toBeNull();
  });

  it("parses a bare multi-digit value with no thousands separator (regression: an earlier strict comma-grouping regex broke this)", () => {
    const n = mk({ id: "n", title: "Reward Codes", content: "- Reward Code: 2002\n" });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows[0]).toMatchObject({ name: "reward code", value: "2002", num: 2002 });
  });

  it("expands spelled-out multipliers, including the corpus's plural typo", () => {
    const n = mk({
      id: "n", title: "Spark Params",
      content: "- `gap`: 50 millions sUSDS\n- `max`: 500 million USDS\n",
    });
    const ix = buildParamIndex(map([n]));
    const gap = ix.rows.find((r) => r.name === "gap")!;
    const max = ix.rows.find((r) => r.name === "max")!;
    expect(gap).toMatchObject({ value: "50 millions sUSDS", num: 50_000_000, unit: "sUSDS" });
    expect(max).toMatchObject({ value: "500 million USDS", num: 500_000_000, unit: "USDS" });
  });

  it("captures a multi-word unit including 'per'", () => {
    const n = mk({ id: "n", title: "Slope", content: "- `slope`: 10,000 USDS per day\n" });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows[0]).toMatchObject({ value: "10,000 USDS per day", num: 10000, unit: "USDS per day" });
  });

  it("strips a trailing parenthetical gloss but keeps the primary value", () => {
    const n = mk({ id: "n", title: "ETH-A", content: "- Initial LTV: 80% (125% collateralization ratio)\n" });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows[0]).toMatchObject({ name: "initial ltv", value: "80%", num: 80, unit: "%" });
  });

  it("keeps the percent convention: 8.75% parses to num=8.75, not 0.0875", () => {
    const n = mk({ id: "n", title: "Rate", content: "- Rate: 8.75%\n" });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows[0]).toMatchObject({ num: 8.75, unit: "%" });
  });

  it("rejects a colon line whose 'value' is actually enumerated prose, not a number", () => {
    const n = mk({
      id: "n", title: "Signer Removal",
      content: "The only exceptions to this are if: 1) a signer self-reports a loss of access to their private key due to any reason; or 2) a signer explicitly expresses their wish to be removed.",
    });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([]);
  });

  it("rejects a bullet whose value is a backtick-wrapped list, not a bare number (Reward Code Ranges shape)", () => {
    const n = mk({ id: "n", title: "Reward Code Ranges", content: "- Skybase: `0`, `1`, and `1000`–1999\n" });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([]);
  });

  it("strips backticks and normalizes a leading article / trailing copula out of the key", () => {
    const n = mk({ id: "n", title: "PSM", content: "- `tin`: 0%\n" });
    const gsm = mk({ id: "gsm", title: "GSM Pause Delay", content: "The GSM Pause Delay is: 48 hours" });
    const ix = buildParamIndex(map([n, gsm]));
    expect(ix.rows.find((r) => r.uuid === "n")).toMatchObject({ name: "tin" });
    expect(ix.rows.find((r) => r.uuid === "gsm")).toMatchObject({ name: "gsm pause delay", value: "48 hours" });
  });

  it("ignores numeric literals inside a fenced code block", () => {
    const n = mk({ id: "n", title: "Spell Check", content: "```\nrequire(maxTickDelta <= 887272);\n```\n" });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([]);
  });

  it("draws the unit boundary at the last letter, not the last character: a sentence-final period is dropped, but an internal dot in a real token symbol is kept", () => {
    const n = mk({
      id: "n", title: "Params",
      content: "- Minimum Positive Participation: 240,000,000 SKY.\n- Supply Cap: 10,000,000 USDC.e\n- `slope`: 100,000,000 USDS/USDC per day\n",
    });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows.find((r) => r.name === "minimum positive participation")).toMatchObject({ value: "240,000,000 SKY", unit: "SKY" });
    expect(ix.rows.find((r) => r.name === "supply cap")).toMatchObject({ value: "10,000,000 USDC.e", unit: "USDC.e" });
    expect(ix.rows.find((r) => r.name === "slope")).toMatchObject({ unit: "USDS/USDC per day" });
  });
});

// ---------------------------------------------------------------------------
// core-child pattern
// ---------------------------------------------------------------------------
describe("core-child pattern", () => {
  it("uses the title as name and the bare content as value", () => {
    const n = mk({ id: "n", title: "Reward Code", content: "`128`." });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([
      { uuid: "n", doc_no: "n", name: "reward code", value: "128", num: 128, unit: null, owner: null, context: "`128`.", source: "core-child" },
    ]);
  });

  it("does not fire on a non-Core doc type even if content is bare", () => {
    const n = mk({ id: "n", title: "Swap Fee", type: "Section", content: "0.0005%" });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([]);
  });

  it("does not fire when content is prose, even if it mentions a number", () => {
    const n = mk({ id: "n", title: "Note", content: "This document explains a concept unrelated to any single value, mentioning the number 5 only in passing." });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// backtick pattern
// ---------------------------------------------------------------------------
describe("backtick pattern", () => {
  it("falls back to the title as name when the doc has exactly one backtick numeric", () => {
    const n = mk({
      id: "n", title: "Capital Ratio",
      content: "The Capital Ratio $CR$ is the capital ratio without additional buffers. It is set to `8.75%`.",
    });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([
      { uuid: "n", doc_no: "n", name: "capital ratio", value: "8.75%", num: 8.75, unit: "%", owner: null, context: "It is set to `8.75%`.", source: "backtick" },
    ]);
  });

  it("prefers a name captured from an in-sentence 'The <Name> ... is `V`' template over the (misleading) title", () => {
    const n = mk({
      id: "n", title: "No Backdoor",
      content: "A protocol with no backdoor access allows no privileged access to the relevant smart contracts. The Starting Rate for a protocol with no backdoor access is `0`.",
    });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([
      { uuid: "n", doc_no: "n", name: "starting rate", value: "0", num: 0, unit: null, owner: null, context: "The Starting Rate for a protocol with no backdoor access is `0`.", source: "backtick" },
    ]);
  });

  it("yields zero rows for a multi-value doc, even when one sentence has an illustrative example (Delay Factor shape)", () => {
    const n = mk({
      id: "n", title: "Delay Factor",
      content: "The Delay Factor is `1` if there is no security delay and `0` if the security delay is 48 hours or greater. So a security delay of 24 hours would result in a Delay Factor of `0.5`.",
    });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([]);
  });

  it("yields zero rows for an imperative-titled procedure doc (Check RateLimits shape)", () => {
    const n = mk({
      id: "n", title: "Check RateLimits",
      content: "The operator must ensure the rate limit stays at `0` until the dependency is live and integration tested.",
    });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([]);
  });

  it("ignores a numeric inside a fenced code block even when a single-backtick token happens to appear there", () => {
    const n = mk({ id: "n", title: "Weird Doc", content: "```\nconst x = `5`;\n```" });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// prose pattern — narrow "quorum of at least N" only
// ---------------------------------------------------------------------------
describe("prose pattern", () => {
  it("extracts 'quorum of at least N signers', ignoring a later unrelated 'at least M' clause, using the whole containing sentence as context", () => {
    const n = mk({
      id: "n", title: "Quorum and Signers",
      content: "Accounts must require a quorum of at least 3 signers for Critical Actions. Each critical action requires approval from signers from at least 2 independent entities.",
    });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([
      { uuid: "n", doc_no: "n", name: "quorum", value: "3", num: 3, unit: "signers", owner: null, context: "Accounts must require a quorum of at least 3 signers for Critical Actions.", source: "prose" },
    ]);
  });

  it("extracts a percent quorum", () => {
    const n = mk({ id: "n", title: "Quorum Requirement", content: "The Root Edit Primitive must specify a minimum quorum of at least 20% of outstanding tokens." });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows[0]).toMatchObject({ name: "quorum", value: "20%", num: 20, unit: "%" });
  });

  it("does not match the unimplemented 'at least N of M signers' phrasing (zero corpus occurrences — not a supported pattern)", () => {
    const n = mk({ id: "n", title: "Signers", content: "Execution requires at least 3 of 5 signers to approve." });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// owner resolution
// ---------------------------------------------------------------------------
describe("owner resolution", () => {
  it("skips generic container types (Scope/Article/Section) and title patterns to find the nearest real entity", () => {
    const scope = mk({ id: "scope", title: "The Stability Scope", type: "Scope", content: "x", depth: 1 });
    const article = mk({ id: "article", title: "Risk Capital", type: "Article", content: "x", parentId: "scope", depth: 2 });
    const section = mk({ id: "section", title: "Implementation", type: "Section", content: "x", parentId: "article", depth: 3 });
    const impl1 = mk({ id: "impl1", title: "Required Risk Capital Calculation Implementation", content: "x", parentId: "section", depth: 4 });
    const impl2 = mk({ id: "impl2", title: "Instance Smart Contract RRC Implementation", content: "x", parentId: "impl1", depth: 5 });
    const leaf = mk({ id: "leaf", title: "Fluid", content: "The Smart Contract Risk Rating for Fluid is `25`.", parentId: "impl2" });
    const ix = buildParamIndex(map([scope, article, section, impl1, impl2, leaf]));
    // every ancestor is generic all the way to the root -> null, not a wrong guess
    expect(ix.rows[0].owner).toBeNull();
  });

  it("resolves the nearest non-generic ancestor as owner, skipping a templated container in between", () => {
    const listOf = mk({ id: "listof", title: "List Of Prime Agent Artifacts", type: "Section", content: "x", depth: 3 });
    const spark = mk({ id: "spark", title: "Spark", content: "x", parentId: "listof", depth: 4 });
    const omni = mk({ id: "omni", title: "Omni Documents", content: "x", parentId: "spark", depth: 5 });
    const leaf = mk({ id: "leaf", title: "Quorum and Signers", content: "Accounts must require a quorum of at least 3 signers for Critical Actions.", parentId: "omni" });
    const ix = buildParamIndex(map([listOf, spark, omni, leaf]));
    expect(ix.rows[0].owner).toBe("spark");
  });

  it("returns null when the doc has no parent", () => {
    const n = mk({ id: "n", title: "Orphan", content: "- Rate: 5%\n" });
    const ix = buildParamIndex(map([n]));
    expect(ix.rows[0].owner).toBeNull();
  });

  it("skips an 'X Registry' container rather than returning it as the owner", () => {
    // "Registry" is a standing container-title family (conceptsCensus.ts's
    // registry-liveness census) — returning one as `owner` would feed a
    // non-entity into verify-checks.ts's name/owner disambiguation gates.
    const registry = mk({ id: "reg", title: "Multisig Registry", content: "x", depth: 4 });
    const leaf = mk({ id: "leaf", title: "Signer Threshold", content: "- Threshold: 4\n", parentId: "reg" });
    const ix = buildParamIndex(map([registry, leaf]));
    expect(ix.rows[0].owner).toBeNull();
  });

  it("still resolves a real entity sitting above a Registry container", () => {
    const spark = mk({ id: "spark", title: "Spark", content: "x", depth: 3 });
    const registry = mk({ id: "reg", title: "Multisig Registry", content: "x", parentId: "spark", depth: 4 });
    const leaf = mk({ id: "leaf", title: "Signer Threshold", content: "- Threshold: 4\n", parentId: "reg" });
    const ix = buildParamIndex(map([spark, registry, leaf]));
    expect(ix.rows[0].owner).toBe("spark");
  });
});

// ---------------------------------------------------------------------------
// matchText
// ---------------------------------------------------------------------------
describe("matchText", () => {
  const spark = mk({ id: "spark", title: "Spark", content: "x", depth: 4 });
  const capitalRatio = mk({ id: "cr", title: "Capital Ratio", content: "It is set to `8.75%`." });
  const maxamount1 = mk({ id: "m1", title: "Mint Max", content: "- `maxAmount`: 10,000 USDS", parentId: "spark" });
  const maxamount2 = mk({ id: "m2", title: "Mint Max 2", content: "- `maxAmount`: 500,000,000 USDS", parentId: "spark" });
  const short = mk({ id: "s1", title: "Short Param", content: "- `a`: 5\n" });
  const ix = buildParamIndex(map([spark, capitalRatio, maxamount1, maxamount2, short]));

  it("matches when all normalized name tokens appear as whole words, ignoring punctuation", () => {
    const hits = ix.matchText("What's the current Capital Ratio, exactly?");
    expect(hits.map((r) => r.name)).toContain("capital ratio");
  });

  it("does not match when only one of two required tokens is present", () => {
    const hits = ix.matchText("The ratio changed recently.");
    expect(hits.find((r) => r.name === "capital ratio")).toBeUndefined();
  });

  it("returns every row sharing an ambiguous name (byName/matchText fan-out — consumers must disambiguate on owner)", () => {
    expect(ix.byName.get("maxamount")).toHaveLength(2); // pinned-interface lookup, asserted directly
    const hits = ix.matchText("the maxAmount is important");
    expect(hits.filter((r) => r.name === "maxamount")).toHaveLength(2);
    expect(new Set(hits.filter((r) => r.name === "maxamount").map((r) => r.owner))).toEqual(new Set(["spark"]));
  });

  it("falls back to using every token when all tokens are shorter than 3 chars", () => {
    expect(ix.matchText("what is a here")).toEqual(expect.arrayContaining([expect.objectContaining({ name: "a" })]));
    expect(ix.matchText("nothing relevant here")).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "a" })]));
  });
});

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------
describe("determinism", () => {
  it("produces identical rows (and byUuid/byName contents) across two builds of the same input", () => {
    const nodes = [
      mk({ id: "a", title: "Alpha", content: "- Rate: 5%\n" }),
      mk({ id: "b", title: "Beta", content: "- Cap: 10,000 USDS\n" }),
      mk({ id: "c", title: "Reward Code", content: "`42`." }),
    ];
    const ix1 = buildParamIndex(map(nodes));
    const ix2 = buildParamIndex(map(nodes.slice().reverse())); // insertion order must not matter
    expect(ix2.rows).toEqual(ix1.rows);
    expect([...ix2.byUuid.entries()]).toEqual([...ix1.byUuid.entries()]);
    expect([...ix2.byName.entries()]).toEqual([...ix1.byName.entries()]);
  });

  it("sorts rows by doc_no, then name, then value, then source", () => {
    const nodes = [
      mk({ id: "z", doc_no: "A.2", title: "Z Doc", content: "- Rate: 1%\n" }),
      mk({ id: "y", doc_no: "A.1", title: "Y Doc", content: "- Rate: 2%\n- Base: 3%\n" }),
    ];
    const ix = buildParamIndex(map(nodes));
    expect(ix.rows.map((r) => [r.doc_no, r.name])).toEqual([
      ["A.1", "base"],
      ["A.1", "rate"],
      ["A.2", "rate"],
    ]);
  });
});
