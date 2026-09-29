// Run via `bun test src/server`. Pure unit tests — no DB, no network.
import { describe, it, expect } from "bun:test";
import { detectIdentitySwaps, bodyWhollyReplaced, renameCampaigns, renameScore, titleSubstitution, RENAME_MIN_KEPT, type SwapNode } from "./identity.ts";
import { mapOf, OZONE_OLD, OZONE_MOVED, SKY_PRIMITIVES } from "./identity-fixtures.ts";

describe("detectIdentitySwaps — a document renamed in place", () => {
  // Real, from upstream next-gen-atlas 32b0cc1 (2025-11-30), which renamed the
  // agent. The name fills the sentence, so exactly 9 of its 18 words survive.
  const OLD = "The party ‘Launch Agent 4’ comprises the Launch Agent 4 Prime Agent, Launch Agent 4 Foundation, and Rubicon.";
  const NEW = "The party 'Obex' comprises the Obex Prime Agent, Obex Foundation, and Rubicon.";
  const was: SwapNode = { id: "665a", doc_no: "A.6.1", title: "Launch Agent 4 Details", content: OLD };
  const now: SwapNode = { id: "665a", doc_no: "A.6.1", title: "Obex Details", content: NEW };
  const run = (main: SwapNode[], preview: SwapNode[], added: string[] = []) =>
    detectIdentitySwaps({ changed: ["665a"], added, mainById: mapOf(main), previewById: mapOf(preview) }).identitySwap;

  it("spares an entity rename that the word measure reads as a replacement", () => {
    expect(bodyWhollyReplaced(OLD, NEW)).toBe(true);
    expect(renameScore(was, now)).toBe(1);
    expect(run([was], [now])).toEqual({});
  });

  it("still flags a sibling that holds the same template under another name", () => {
    // "Sky Details" holding "Grove Details": the title makes the same kind of
    // substitution, and the bodies are not the same sentence. Scores 0.833.
    const sky: SwapNode = { id: "665a", doc_no: "A.6.1", title: "Sky Details", content: "The party 'Sky' comprises Sky Core and its Governance Facilitators." };
    const grove: SwapNode = { id: "665a", doc_no: "A.6.1", title: "Grove Details", content: "The party 'Grove' comprises the Grove Prime Agent and Grove Foundation." };
    expect(renameScore(sky, grove)!).toBeLessThan(RENAME_MIN_KEPT);
    expect(Object.keys(run([sky], [grove]))).toEqual(["665a"]);
  });

  it("has no score when the title made no substitution, or the body holds none of its words", () => {
    expect(renameScore({ ...was, title: "Details" }, { ...now, title: "Details Of The Party" })).toBeNull(); // words only added
    expect(renameScore({ ...was, content: "The allocation is 21,000,000 USDS, paid monthly." }, now)).toBeNull();
  });

  it("yields to a demonstrated relocation: the old content moved, so the UUID was repurposed", () => {
    const moved: SwapNode = { id: "new1", doc_no: "A.6.9", title: "Launch Agent 4 Details", content: OLD };
    const swaps = run([was], [now, moved], ["new1"]);
    expect(swaps["665a"]?.movedTo?.id).toBe("new1");
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
