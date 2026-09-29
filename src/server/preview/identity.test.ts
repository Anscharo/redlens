// Run via `bun test src/server`. Pure unit tests — no DB, no network.
import { describe, it, expect } from "bun:test";
import { detectIdentitySwaps, bodyWhollyReplaced, lineOverlap, orderedWordContainment, renameCampaigns, titleSubstitution, type SwapNode } from "./identity.ts";

function mapOf(nodes: SwapNode[]): Map<string, SwapNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

// The real fork case (Redline-Group:ozone-executor-agent-artifact): UUID
// a491d7d0 kept its doc number but was repurposed from "Operational GovOps"
// (Ozone) to "Sky Primitives", and the old GovOps content moved (expanded) to a
// brand-new UUID 384d29b0.
const OZONE_OLD = "Operational GovOps for Operational Executor Agent Ozone is Soter Labs.";
const SKY_PRIMITIVES = "The documents herein implement the Sky Primitives for Ozone See [A.2.2 - Sky Primitives](https://sky-atlas.io/#fcde2604).";
const OZONE_MOVED = OZONE_OLD + " Soter Labs plays a crucial role in implementing Prime Agent strategies.";
const OZONE_MOVED_TYPO = OZONE_OLD.replace("Operational", "Operatonal") + " Soter Labs plays a crucial role here."; // subword typo
const OZONE_SUBST = OZONE_OLD.replace("Soter Labs", "Acme Corp"); // a real word substitution, not a typo

describe("detectIdentitySwaps", () => {
  it("flags a repurposed UUID and links to where the old content moved (expanded)", () => {
    const main = mapOf([{ id: "a491", doc_no: "A.6.1.2.2.2", title: "Operational GovOps", content: OZONE_OLD }]);
    const preview = mapOf([
      { id: "a491", doc_no: "A.6.1.2.2.2", title: "Sky Primitives", content: SKY_PRIMITIVES },
      { id: "384d", doc_no: "A.6.1.2.2.2.1.1.3.1.1.5.2", title: "Soter Labs -", content: OZONE_MOVED },
    ]);
    const { identitySwap, formerUuid } = detectIdentitySwaps({ changed: ["a491"], added: ["384d"], mainById: main, previewById: preview });
    expect(identitySwap.a491).toMatchObject({ oldTitle: "Operational GovOps", newTitle: "Sky Primitives", movedTo: { id: "384d" } });
    expect(formerUuid["384d"]).toMatchObject({ previousId: "a491", previousTitle: "Operational GovOps" });
  });

  it("tolerates a subword typo in the relocated content", () => {
    const main = mapOf([{ id: "a491", doc_no: "A.1", title: "Operational GovOps", content: OZONE_OLD }]);
    const preview = mapOf([
      { id: "a491", doc_no: "A.1", title: "Sky Primitives", content: SKY_PRIMITIVES },
      { id: "384d", doc_no: "A.9", title: "Soter Labs -", content: OZONE_MOVED_TYPO },
    ]);
    const { formerUuid } = detectIdentitySwaps({ changed: ["a491"], added: ["384d"], mainById: main, previewById: preview });
    expect(formerUuid["384d"]?.previousId).toBe("a491");
  });

  it("does NOT relocate to a near-duplicate that differs by a real word (not a typo)", () => {
    const main = mapOf([{ id: "a491", doc_no: "A.1", title: "Operational GovOps", content: OZONE_OLD }]);
    const preview = mapOf([
      { id: "a491", doc_no: "A.1", title: "Sky Primitives", content: SKY_PRIMITIVES },
      { id: "other", doc_no: "A.9", title: "Other Entity", content: OZONE_SUBST },
    ]);
    const { identitySwap, formerUuid } = detectIdentitySwaps({ changed: ["a491"], added: ["other"], mainById: main, previewById: preview });
    expect(identitySwap.a491).toBeDefined(); // still a swap
    expect(identitySwap.a491.movedTo).toBeUndefined(); // but not a false relocation
    expect(Object.keys(formerUuid)).toHaveLength(0);
  });

  it("does NOT relocate boilerplate that recurs across the live atlas", () => {
    const main = mapOf([
      { id: "a491", doc_no: "A.1", title: "Operational GovOps", content: OZONE_OLD },
      { id: "dup", doc_no: "A.2", title: "Operational GovOps", content: OZONE_OLD }, // same content elsewhere → boilerplate
    ]);
    const preview = mapOf([
      { id: "a491", doc_no: "A.1", title: "Sky Primitives", content: SKY_PRIMITIVES },
      { id: "384d", doc_no: "A.9", title: "Soter Labs -", content: OZONE_MOVED },
    ]);
    const { identitySwap, formerUuid } = detectIdentitySwaps({ changed: ["a491"], added: ["384d"], mainById: main, previewById: preview });
    expect(identitySwap.a491).toBeDefined();
    expect(identitySwap.a491.movedTo).toBeUndefined();
    expect(Object.keys(formerUuid)).toHaveLength(0);
  });

  it("does NOT relocate when two added docs both contain the old content (ambiguous)", () => {
    const main = mapOf([{ id: "a491", doc_no: "A.1", title: "Operational GovOps", content: OZONE_OLD }]);
    const preview = mapOf([
      { id: "a491", doc_no: "A.1", title: "Sky Primitives", content: SKY_PRIMITIVES },
      { id: "m1", doc_no: "A.9", title: "Home 1", content: OZONE_MOVED },
      { id: "m2", doc_no: "A.10", title: "Home 2", content: OZONE_MOVED },
    ]);
    const { identitySwap } = detectIdentitySwaps({ changed: ["a491"], added: ["m1", "m2"], mainById: main, previewById: preview });
    expect(identitySwap.a491?.movedTo).toBeUndefined();
  });

  it("records a swap with no movedTo when the old content was deleted, not moved", () => {
    const main = mapOf([{ id: "a491", doc_no: "A.1", title: "Operational GovOps", content: OZONE_OLD }]);
    const preview = mapOf([{ id: "a491", doc_no: "A.1", title: "Sky Primitives", content: SKY_PRIMITIVES }]);
    const { identitySwap, formerUuid } = detectIdentitySwaps({ changed: ["a491"], added: [], mainById: main, previewById: preview });
    expect(identitySwap.a491.movedTo).toBeUndefined();
    expect(Object.keys(formerUuid)).toHaveLength(0);
  });

  it("does NOT flag an ordinary edit (same title, body mostly preserved)", () => {
    const main = mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate", content: "The reward rate is 5%.\nReviewed quarterly." }]);
    const preview = mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate", content: "The reward rate is 7%.\nReviewed quarterly." }]);
    const { identitySwap } = detectIdentitySwaps({ changed: ["x"], added: [], mainById: main, previewById: preview });
    expect(identitySwap.x).toBeUndefined();
  });

  it("does NOT flag a specialization where the new title extends the old (no relocated content)", () => {
    const main = mapOf([{ id: "x", doc_no: "A.6.1.2.2", title: "Operational Executor Agent", content: "Generic agent template.\nFill in per instance." }]);
    const preview = mapOf([{ id: "x", doc_no: "A.6.1.2.2", title: "Operational Executor Agent Ozone", content: "Ozone is the operational executor agent.\nManaged by Soter Labs." }]);
    const { identitySwap } = detectIdentitySwaps({ changed: ["x"], added: [], mainById: main, previewById: preview });
    expect(identitySwap.x).toBeUndefined();
  });

  it("DOES flag a specialization-looking retitle when the old content demonstrably relocated", () => {
    const main = mapOf([{ id: "x", doc_no: "A.1", title: "Reward Module", content: OZONE_OLD }]);
    const preview = mapOf([
      { id: "x", doc_no: "A.1", title: "Reward Module v2", content: SKY_PRIMITIVES },
      { id: "z", doc_no: "A.9", title: "Archive", content: OZONE_MOVED },
    ]);
    const { identitySwap, formerUuid } = detectIdentitySwaps({ changed: ["x"], added: ["z"], mainById: main, previewById: preview });
    expect(identitySwap.x?.movedTo?.id).toBe("z");
    expect(formerUuid.z?.previousId).toBe("x");
  });

  it("does NOT flag a retitle that keeps the same body (rename, not swap)", () => {
    const body = "The reward rate is 5%.\nReviewed quarterly.";
    const main = mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate", content: body }]);
    const preview = mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate (legacy)", content: body }]);
    const { identitySwap } = detectIdentitySwaps({ changed: ["x"], added: [], mainById: main, previewById: preview });
    expect(identitySwap.x).toBeUndefined();
  });

  it("does NOT flag filling an empty placeholder, or blanking a doc", () => {
    const filled = detectIdentitySwaps({
      changed: ["x"], added: [],
      mainById: mapOf([{ id: "x", doc_no: "A.1", title: "Placeholder", content: "" }]),
      previewById: mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate", content: "The reward rate is 5%." }]),
    });
    expect(filled.identitySwap.x).toBeUndefined();
    const blanked = detectIdentitySwaps({
      changed: ["x"], added: [],
      mainById: mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate", content: "The reward rate is 5%." }]),
      previewById: mapOf([{ id: "x", doc_no: "A.1", title: "Removed", content: "" }]),
    });
    expect(blanked.identitySwap.x).toBeUndefined();
  });

  // Regression — next-gen-atlas#346 (preview sha e60a8a36). A spelling pass
  // (`ALMProxy` → `ALM Proxy`, `LitePSM` → `Lite PSM`) retitled and edited three
  // one-line docs, and all three came back badged "identity changed". Two
  // independent defects, so both sides are pinned: the title was only respelled
  // around its separators, AND the body edit was tiny — but the body lives on a
  // single line, where lineOverlap can only answer 1 or 0.
  const ALM = [
    {
      id: "810671ff-8674-4178-a7ce-dd98c112688d",
      old: "The ALMProxy for Keel is whitelisted on the LitePSM. This allows Keel to call `buyGemNoFee` and `sellGemNoFee` on the `MCD_LITE_PSM_USDC_A` contract.",
      neu: "The ALM Proxy for Keel is whitelisted on the Lite PSM. This allows Keel to call `buyGemNoFee` and `sellGemNoFee` on the `MCD_LITE_PSM_USDC_A` contract.",
    },
    {
      id: "5c795414-020c-432d-91b6-a7d72495452e",
      old: "The ALMProxy for Obex must be whitelisted on the LitePSM. This will effectively allow Obex to call `buyGemNoFee` and `sellGemNoFee` on the `MCD_LITE_PSM_USDC_A` contract.",
      neu: "The ALM Proxy for Obex is whitelisted on the Lite PSM. This allows Obex to call `buyGemNoFee` and `sellGemNoFee` on the `MCD_LITE_PSM_USDC_A` contract.",
    },
    {
      id: "a8094362-4ca8-4bf0-a1d8-bbed3c80d61c",
      old: "The ALMProxy for Pattern must be whitelisted on the LitePSM. This will effectively allow Pattern to call `buyGemNoFee` and `sellGemNoFee` on the `MCD_LITE_PSM_USDC_A` contract.",
      neu: "The ALM Proxy for Pattern is whitelisted on the Lite PSM. This allows Pattern to call `buyGemNoFee` and `sellGemNoFee` on the `MCD_LITE_PSM_USDC_A` contract.",
    },
  ];

  it.each(ALM)("does NOT flag atlas#346's ALMProxy respelling ($id)", ({ id, old, neu }) => {
    const { identitySwap } = detectIdentitySwaps({
      changed: [id], added: [],
      mainById: mapOf([{ id, doc_no: "A.2.9.3.1", title: "Whitelisting Of ALMProxy", content: old }]),
      previewById: mapOf([{ id, doc_no: "A.2.9.3.1", title: "Whitelisting Of ALM Proxy", content: neu }]),
    });
    expect(identitySwap[id]).toBeUndefined();
  });

  it("does NOT flag a one-line body whose title AND wording both changed, when the text survives", () => {
    // The general form of the #346 case: an unrelated retitle (nothing to do
    // with the old title) on top of a small one-line body edit. The title gate
    // does NOT save this one — only the word-granular body measure does.
    const old = "The reward rate for the Star is reviewed by the Facilitator each quarter and published on chain.";
    const neu = "The reward rate for the Star is reviewed by the Operational Facilitator every quarter and published on chain.";
    const { identitySwap } = detectIdentitySwaps({
      changed: ["x"], added: [],
      mainById: mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate Review", content: old }]),
      previewById: mapOf([{ id: "x", doc_no: "A.1", title: "Quarterly Cadence", content: neu }]),
    });
    expect(identitySwap.x).toBeUndefined();
  });

  it("STILL flags a one-line body genuinely replaced by a different document", () => {
    // The true positive the word-granular measure must not cost us: same shape
    // as the case above (one line, retitled), but the text is gone.
    const { identitySwap } = detectIdentitySwaps({
      changed: ["x"], added: [],
      mainById: mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate Review", content: OZONE_OLD }]),
      previewById: mapOf([{ id: "x", doc_no: "A.1", title: "Sky Primitives", content: SKY_PRIMITIVES }]),
    });
    expect(identitySwap.x).toBeDefined();
  });

  it("does NOT flag a body too short to carry evidence either way", () => {
    const { identitySwap } = detectIdentitySwaps({
      changed: ["x"], added: [],
      mainById: mapOf([{ id: "x", doc_no: "A.1", title: "Rate", content: "The rate is 5%." }]),
      previewById: mapOf([{ id: "x", doc_no: "A.1", title: "Ceiling", content: "The cap is 9m." }]),
    });
    expect(identitySwap.x).toBeUndefined();
  });
});

describe("bulk renames", () => {
  // A campaign that changes a REAL word, so squashTitle can't equate the two
  // titles and each doc would otherwise be judged alone. Bodies are wholly
  // replaced, so only the campaign rule stands between these and three badges.
  const campaign = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `d${i}`,
      before: { id: `d${i}`, doc_no: `A.${i}`, title: `Whitelisting Of Proxy ${i}`, content: OZONE_OLD },
      after: { id: `d${i}`, doc_no: `A.${i}`, title: `Allowlisting Of Proxy ${i}`, content: SKY_PRIMITIVES },
    }));

  function run(n: number) {
    const docs = campaign(n);
    return detectIdentitySwaps({
      changed: docs.map((d) => d.id), added: [],
      mainById: mapOf(docs.map((d) => d.before)),
      previewById: mapOf(docs.map((d) => d.after)),
    });
  }

  it("does NOT flag documents sharing one retitle across the diff", () => {
    expect(Object.keys(run(3).identitySwap)).toEqual([]);
  });

  it("STILL flags the same retitle when only one document takes it", () => {
    // Below CAMPAIGN_MIN_DOCS there is no campaign to infer — one document
    // retitled and rewritten is exactly what the badge is for.
    expect(Object.keys(run(1).identitySwap)).toEqual(["d0"]);
  });

  it("does NOT let a wholesale retitle form a campaign", () => {
    // A family of documents genuinely replaced en masse all change title the
    // same way — by changing all of it. That must yield no key, so agreeing
    // with each other cannot wave them through.
    const docs = Array.from({ length: 4 }, (_, i) => ({
      id: `d${i}`,
      before: { id: `d${i}`, doc_no: `A.${i}`, title: "Operational GovOps", content: OZONE_OLD },
      after: { id: `d${i}`, doc_no: `A.${i}`, title: "Sky Primitives", content: SKY_PRIMITIVES },
    }));
    const { identitySwap } = detectIdentitySwaps({
      changed: docs.map((d) => d.id), added: [],
      mainById: mapOf(docs.map((d) => d.before)),
      previewById: mapOf(docs.map((d) => d.after)),
    });
    expect(Object.keys(identitySwap).sort()).toEqual(["d0", "d1", "d2", "d3"]);
  });

  it("a campaign still yields to demonstrably relocated content", () => {
    // Two docs take the same retitle, but one's old body turns up in a new
    // uuid — the rename is coincidental, that uuid really was repurposed.
    const main = mapOf([
      { id: "x", doc_no: "A.1", title: "Whitelisting Of Proxy One", content: OZONE_OLD },
      { id: "y", doc_no: "A.2", title: "Whitelisting Of Proxy Two", content: "Unrelated body text that stays put across this diff entirely." },
    ]);
    const preview = mapOf([
      { id: "x", doc_no: "A.1", title: "Allowlisting Of Proxy One", content: SKY_PRIMITIVES },
      { id: "y", doc_no: "A.2", title: "Allowlisting Of Proxy Two", content: "A different body altogether, sharing nothing with what stood here." },
      { id: "z", doc_no: "A.9", title: "Archive", content: OZONE_MOVED },
    ]);
    const { identitySwap } = detectIdentitySwaps({ changed: ["x", "y"], added: ["z"], mainById: main, previewById: preview });
    expect(identitySwap.x?.movedTo?.id).toBe("z");
    expect(identitySwap.y).toBeUndefined(); // no relocation → campaign holds
  });

  it("titleSubstitution: same edit → same key, different edit or wholesale retitle → not grouped", () => {
    const k = titleSubstitution("Whitelisting Of ALMProxy", "Whitelisting Of ALM Proxy");
    expect(k).toBeTruthy();
    expect(titleSubstitution("Reporting Of ALMProxy", "Reporting Of ALM Proxy")).toBe(k!); // same campaign
    expect(titleSubstitution("Whitelisting Of ALMProxy", "Whitelisting Of LitePSM")).not.toBe(k!);
    expect(titleSubstitution("Operational GovOps", "Sky Primitives")).toBeNull(); // nothing survives
    expect(titleSubstitution("Reward Rate", "Reward Rate")).toBeNull(); // no edit at all
  });

  it("renameCampaigns groups by the edit, not by the title", () => {
    const main = mapOf([
      { id: "a", doc_no: "A.1", title: "Whitelisting Of ALMProxy", content: "x" },
      { id: "b", doc_no: "A.2", title: "Reporting Of ALMProxy", content: "x" },
      { id: "c", doc_no: "A.3", title: "Staking Of LitePSM", content: "x" },
    ]);
    const preview = mapOf([
      { id: "a", doc_no: "A.1", title: "Whitelisting Of ALM Proxy", content: "y" },
      { id: "b", doc_no: "A.2", title: "Reporting Of ALM Proxy", content: "y" },
      { id: "c", doc_no: "A.3", title: "Staking Of Lite PSM", content: "y" }, // a DIFFERENT substitution
    ]);
    const members = renameCampaigns({ changed: ["a", "b", "c"], mainById: main, previewById: preview });
    expect([...members].sort()).toEqual(["a", "b"]); // c is alone in its edit
  });
});

describe("similarity helpers", () => {
  it("lineOverlap: identical=1, disjoint≈0, empty handling", () => {
    expect(lineOverlap("a\nb", "a\nb")).toBe(1);
    expect(lineOverlap(OZONE_OLD, SKY_PRIMITIVES)).toBeLessThanOrEqual(0.15);
    expect(lineOverlap("", "")).toBe(1);
    expect(lineOverlap("a", "")).toBe(0);
  });

  it("orderedWordContainment: full=1, expanded=1, typo≈1, real substitution<0.95, unrelated low", () => {
    expect(orderedWordContainment(OZONE_OLD, OZONE_OLD)).toBe(1);
    expect(orderedWordContainment(OZONE_OLD, OZONE_MOVED)).toBe(1); // expanded
    expect(orderedWordContainment(OZONE_OLD, OZONE_MOVED_TYPO)).toBeGreaterThanOrEqual(0.95); // typo tolerated
    expect(orderedWordContainment(OZONE_OLD, OZONE_SUBST)).toBeLessThan(0.95); // real word changed
    expect(orderedWordContainment(OZONE_OLD, SKY_PRIMITIVES)).toBeLessThan(0.5);
    expect(orderedWordContainment("one two three", "one two three four")).toBe(0); // below RELOCATION_MIN_WORDS
  });

  it("lineOverlap is BINARY on a one-line body — the defect bodyWhollyReplaced exists to route around", () => {
    // Not a wish, a fact about the measure: the LCS runs over two 1-element
    // arrays, so a single changed word and a wholesale replacement both score
    // 0. 83% of the live atlas is one line. If this ever stops being true,
    // bodyWhollyReplaced's short-body branch can be reconsidered — until then,
    // never route a short body back through lineOverlap.
    const one = "The ALMProxy for Keel is whitelisted on the LitePSM contract today.";
    expect(lineOverlap(one, one.replace("ALMProxy", "ALM Proxy"))).toBe(0); // one word
    expect(lineOverlap(one, SKY_PRIMITIVES)).toBe(0); // a different document
  });

  it("bodyWhollyReplaced: word-granular under the line cap, line-granular above it", () => {
    const one = "The ALMProxy for Keel is whitelisted on the LitePSM contract and reviewed yearly.";
    expect(bodyWhollyReplaced(one, one.replace("ALMProxy", "ALM Proxy"))).toBe(false); // small edit
    expect(bodyWhollyReplaced(OZONE_OLD, SKY_PRIMITIVES)).toBe(true); // different document
    // Above the cap the original line measure still rules: many lines, few shared.
    const many = ["alpha line", "beta line", "gamma line", "delta line", "epsilon line"].join("\n");
    expect(bodyWhollyReplaced(many, many)).toBe(false);
    expect(bodyWhollyReplaced(many, ["one", "two", "three", "four", "five"].join("\n"))).toBe(true);
    // Too little text to judge.
    expect(bodyWhollyReplaced("The rate is 5%.", "The cap is 9m.")).toBe(false);
  });
});
