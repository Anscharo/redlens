// Unit tests for the pure heuristics in scripts/lib/history-classify.mjs.
// Each case targets a behaviour iterated during the matcher work — they
// lock in the chosen tradeoffs so a future tweak doesn't silently regress.

import { describe, it, expect } from "vitest";
import {
  classifyDiff,
  classifyPrTitle,
  cleanDescription,
  parsePrBullets,
  tokenize,
  parentDocNo,
  ancestorWalkFor,
  matchScore,
  explicitRefs,
  nodeInRefScope,
  detectAgentScope,
  matchBulletsToNodes,
  nodeTokenSets,
} from "../scripts/lib/history-classify.mjs";

// ─────────────────────────────────── classifyPrTitle

describe("classifyPrTitle", () => {
  it.each([
    ["fix typos", "typo"],
    ["Fix typo in active data", "typo"],
    ["spelling fix", "typo"],
    ["Spelling fixes", "typo"],
    ["Correct typo", "typo"],
    ["remove whitespace in lists", "lint"],
    ["remove non breaking space characters", "lint"],
    ["non-breaking space cleanup", "lint"],
    ["formatting tweaks", "lint"],
    ["lint fixes", "lint"],
    ["Atlas Edit Proposal — 2026-04-20", null],
    ["SAEP-07", null],
    ["", null],
  ])("classifies %j as %j", (title, expected) => {
    expect(classifyPrTitle(title as string)).toBe(expected);
  });
});

// ─────────────────────────────────── classifyDiff

describe("classifyDiff", () => {
  it("returns null on empty diff", () => {
    expect(classifyDiff([])).toBeNull();
    expect(classifyDiff(undefined)).toBeNull();
  });

  it("pure-whitespace removal → lint", () => {
    expect(classifyDiff([["-", "   "], ["=", "foo"]])).toBe("lint");
  });

  it("single-character punctuation removal → lint", () => {
    expect(classifyDiff([["-", "*"], ["=", "foo"]])).toBe("lint");
  });

  it("1-char letter change → typo (within ≤4-char, max-2-run budget)", () => {
    expect(classifyDiff([["~", [["=", "doc"], ["+", "u"], ["=", "ment"]]]])).toBe("typo");
  });

  it("3-char single-run change → semantic (exceeds max-2-run)", () => {
    // Word-diff treats "teh"→"the" as two 3-letter tokens; both runs are 3.
    expect(classifyDiff([["~", [["-", "teh"], ["+", "the"]]]])).toBe("semantic");
  });

  it("5-char total change spread across two short runs → semantic", () => {
    expect(
      classifyDiff([["~", [["+", "ab"], ["=", "x"], ["+", "cde"]]]]),
    ).toBe("semantic");
  });

  it("substantial multi-line addition → semantic", () => {
    expect(
      classifyDiff([
        ["+", "Add new sub-document Foo Bar Baz of A.6.1.1.5"],
        ["+", "with parameters X Y Z"],
      ]),
    ).toBe("semantic");
  });

  it("classify gap-only diff as null (no actual edits)", () => {
    expect(classifyDiff([["…"], ["=", "x"]])).toBeNull();
  });
});

// ─────────────────────────────────── cleanDescription

describe("cleanDescription", () => {
  it("strips Do not merge unless poll passes", () => {
    expect(cleanDescription("**Do not merge unless associated poll passes**")).toBeNull();
  });
  it("strips Do not post variants", () => {
    expect(cleanDescription("**Do not post unless associated poll passes.**")).toBeNull();
  });
  it("strips Originating forum post line", () => {
    const s = "Originating forum post: <https://forum.skyeco.com/t/foo/1>";
    expect(cleanDescription(s)).toBeNull();
  });
  it("strips boilerplate but keeps real content", () => {
    const s =
      "This PR includes a real description of changes\n\n" +
      "**Do not merge unless associated poll passes**";
    const out = cleanDescription(s);
    expect(out).toContain("real description");
    expect(out).not.toMatch(/poll passes/i);
    expect(out).not.toMatch(/do not merge/i);
  });
  it("returns null for bare URL", () => {
    expect(cleanDescription("https://forum.sky.money/t/foo/1")).toBeNull();
  });
  it("returns null for empty/short residue", () => {
    expect(cleanDescription("")).toBeNull();
    expect(cleanDescription(null)).toBeNull();
    expect(cleanDescription("hi")).toBeNull();
  });
});

// ─────────────────────────────────── parsePrBullets

describe("parsePrBullets", () => {
  it("parses canonical `- **Title** — description` bullets", () => {
    const body = [
      "- **Add Spark Instance** — Adds the Spark instance to the artifact.",
      "- **Update Risk Parameters** - Tweaks risk thresholds for Anchorage.",
      "* **Mixed Marker** — Bullet starting with `*` not `-`.",
    ].join("\n");
    const out = parsePrBullets(body);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      title: "Add Spark Instance",
      description: "Adds the Spark instance to the artifact.",
    });
    expect(out[1].description).toMatch(/Anchorage/);
    expect(out[2].title).toBe("Mixed Marker");
  });
  it("returns [] for empty or non-bullet bodies", () => {
    expect(parsePrBullets("")).toEqual([]);
    expect(parsePrBullets("just some prose, no bullets")).toEqual([]);
    expect(parsePrBullets(null)).toEqual([]);
  });
});

// ─────────────────────────────────── tokenize / parentDocNo / ancestorWalkFor

describe("tokenize", () => {
  it("lowercases, splits, drops short and stop words", () => {
    expect(tokenize("The Quick Brown Fox of A.1.2")).toEqual(["quick", "brown", "fox"]);
  });
  it("keeps alphanumerics", () => {
    expect(tokenize("Launch Agent 7 Artifact")).toEqual(["launch", "agent", "artifact"]);
  });
});

describe("parentDocNo", () => {
  it("strips the last segment", () => {
    expect(parentDocNo("A.6.1.1.8")).toBe("A.6.1.1");
    expect(parentDocNo("A.6")).toBe("A");
  });
  it("returns null for single-segment", () => {
    expect(parentDocNo("A")).toBeNull();
  });
});

describe("ancestorWalkFor", () => {
  it("walks 1 for shallow, 6 for deep", () => {
    expect(ancestorWalkFor(2)).toBe(1);
    expect(ancestorWalkFor(3)).toBe(1);
    expect(ancestorWalkFor(4)).toBe(2);
    expect(ancestorWalkFor(7)).toBe(4);
    expect(ancestorWalkFor(10)).toBe(6);
    expect(ancestorWalkFor(15)).toBe(6);
  });
});

// ─────────────────────────────────── nodeTokenSets

describe("nodeTokenSets", () => {
  it("excludes own tokens from ancestors", () => {
    const snap = new Map<string, { doc_no: string; title: string }>([
      ["A.6.1", { doc_no: "A.6.1", title: "Agent Artifacts" }],
      ["A.6.1.1", { doc_no: "A.6.1.1", title: "List Of Prime Agent Artifacts" }],
    ]);
    const node = { id: "id", doc_no: "A.6.1.1.8", title: "Launch Agent 7" };
    const { own, ancestors } = nodeTokenSets(node, snap);
    expect(own).toEqual(new Set(["launch", "agent"]));
    expect(ancestors.has("agent")).toBe(false); // dedup against own
    expect(ancestors.has("artifacts")).toBe(true);
  });
});

// ─────────────────────────────────── matchScore

describe("matchScore", () => {
  const own = new Set(["launch", "agent"]);
  const anc = new Set(["list", "prime", "artifacts"]);

  it("rejects single-desc-only own hit (LA7 / Skybase regression case)", () => {
    // bullet title has no overlap with own; bullet description mentions "agent"
    expect(
      matchScore(
        { title: "Clarify References To Ozone", description: "Operational Executor Agent for ..." },
        own,
        anc,
      ),
    ).toBe(0);
  });

  it("accepts match when bullet title contains own token", () => {
    expect(
      matchScore({ title: "Add Launch Agent 7 Artifact", description: "" }, own, anc),
    ).toBeGreaterThan(0.5);
  });

  it("accepts match when ≥2 ancestor tokens land in bullet title", () => {
    // own="single,instance,configuration,document" — none in bullet title
    // anc="list,prime,agent,artifacts" — 2 land in bullet title
    expect(
      matchScore(
        { title: "Add Prime Agent Artifacts Outline", description: "" },
        new Set(["single", "instance", "configuration", "document"]),
        new Set(["list", "prime", "agent", "artifacts"]),
      ),
    ).toBeGreaterThan(0);
  });

  it("zero score when no overlap at all", () => {
    expect(matchScore({ title: "Unrelated Banana Pancakes", description: "Cinnamon" }, own, anc)).toBe(0);
  });
});

// ─────────────────────────────────── explicitRefs / scope

describe("explicitRefs", () => {
  it("collects doc_no and UUID mentions from title + description", () => {
    const refs = explicitRefs({
      title: "Edit A.6.1.1.8 - Foo",
      description: "Replace document at 12345678-aaaa-bbbb-cccc-1234567890ab",
    });
    expect(refs.docNos).toContain("A.6.1.1.8");
    expect(refs.uuids).toContain("12345678-aaaa-bbbb-cccc-1234567890ab");
  });
});

describe("nodeInRefScope", () => {
  it("matches exact and descendant", () => {
    const refs = new Set(["A.6.1.1.4"]);
    expect(nodeInRefScope("A.6.1.1.4", refs)).toBe(true);
    expect(nodeInRefScope("A.6.1.1.4.2.1", refs)).toBe(true);
    expect(nodeInRefScope("A.6.1.1.8", refs)).toBe(false);
    expect(nodeInRefScope("A.6.1.1.40", refs)).toBe(false); // not a prefix
  });
});

describe("detectAgentScope", () => {
  const map: [string, string][] = [
    ["Spark", "A.6.1.1.1"],
    ["Grove", "A.6.1.1.2"],
    ["Keel", "A.6.1.1.3"],
    ["Launch Agent 7", "A.6.1.1.8"],
  ];
  it("matches whole-word agent names", () => {
    expect(detectAgentScope("Add Solana Pioneer Chain Instance To Keel", map)).toEqual(["A.6.1.1.3"]);
    expect(detectAgentScope("Designate Grove As Avalanche Pioneer Prime", map)).toEqual(["A.6.1.1.2"]);
    expect(detectAgentScope("Add Launch Agent 7 Artifact", map)).toEqual(["A.6.1.1.8"]);
  });
  it("returns [] when no agent name present", () => {
    expect(detectAgentScope("Update Risk Parameters", map)).toEqual([]);
  });
  it("multi-agent title yields multiple scopes", () => {
    expect(detectAgentScope("Bridge Spark And Grove", map).sort()).toEqual([
      "A.6.1.1.1",
      "A.6.1.1.2",
    ]);
  });
});

// ─────────────────────────────────── matchBulletsToNodes (integration of above)

describe("matchBulletsToNodes", () => {
  it("attributes via ref when bullet text contains node's doc_no", () => {
    const snap = new Map();
    const bullets = [
      { title: "Generic edit", description: "Replace A.6.1.1.8 - Launch Agent 7 with x." },
    ];
    const nodes = [{ id: "n1", doc_no: "A.6.1.1.8", title: "Launch Agent 7" }];
    const out = matchBulletsToNodes(bullets, nodes, snap);
    expect(out.get("n1")?.via).toBe("ref");
    expect(out.get("n1")?.bulletTitle).toBe("Generic edit");
  });

  it("agent-name scope filters cross-agent false positive (Keel→Grove)", () => {
    const snap = new Map<string, { doc_no: string; title: string }>([
      ["A.6.1.1.2.2.5", { doc_no: "A.6.1.1.2.2.5", title: "Demand Side Stablecoin Primitives" }],
      ["A.6.1.1.2.2.5.3", { doc_no: "A.6.1.1.2.2.5.3", title: "Pioneer Chain Primitive" }],
    ]);
    const bullets = [
      {
        title: "Add Solana Pioneer Chain Instance To Keel",
        description: "Adds the Solana ICD to Keel's Pioneer Chain Primitive.",
      },
    ];
    const groveNode = {
      id: "g1",
      doc_no: "A.6.1.1.2.2.5.3.2.1.1.2.1",
      title: "Network",
    };
    const out = matchBulletsToNodes(bullets, [groveNode], snap, {
      agentNamePrefixes: [
        ["Spark", "A.6.1.1.1"],
        ["Grove", "A.6.1.1.2"],
        ["Keel", "A.6.1.1.3"],
      ],
    });
    // bullets.length === 1 so sole-bullet fallback fires regardless of fuzzy
    // failure — what we want to verify is that fuzzy didn't attribute under
    // its own logic. Easiest assertion: via != "fuzzy".
    expect(out.get("g1")?.via).toBe("sole-bullet");
  });

  it("returns empty map for empty bullets", () => {
    expect(matchBulletsToNodes([], [{ id: "n", doc_no: "A.1", title: "X" }], new Map()).size).toBe(0);
  });

  it("sole-bullet fallback attaches the only bullet to all unmatched nodes", () => {
    const bullets = [{ title: "SAEP-07", description: "Spark Prime Brokerage proposal." }];
    const nodes = [
      { id: "a", doc_no: "A.6.1.1.1.x.y", title: "Unrelated A" },
      { id: "b", doc_no: "A.6.1.1.1.x.z", title: "Unrelated B" },
    ];
    const out = matchBulletsToNodes(bullets, nodes, new Map());
    expect(out.get("a")?.via).toBe("sole-bullet");
    expect(out.get("b")?.via).toBe("sole-bullet");
  });
});
