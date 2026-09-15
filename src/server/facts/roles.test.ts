// facts/roles.ts — the role dossier fact. Pure in-memory index, no network.
import { describe, it, expect } from "bun:test";
import { buildIndexes, type AtlasNode } from "../retrieval/indexes.ts";
import type { Glossary, GlossaryEntry } from "../../lib/glossaryLookup.ts";
import { DEFINITIONS_SECTION_ID, matchRoles, roleCatalog, roleDossier, rolesFact } from "./roles.ts";

let order = 0;
function doc(id: string, doc_no: string, title: string, content: string, depth: number, parentId: string | null = null): AtlasNode {
  return { id, doc_no, title, type: "Core", depth, parentId, content, order: order++, addressRefs: [] };
}
const g = (term: string, nodeId: string): GlossaryEntry => ({ term, content: "", nodeId, docNo: "A.0", sourceDocNo: "A.0", sourceContext: null });

const DOCS: AtlasNode[] = [
  doc(DEFINITIONS_SECTION_ID, "A.0.1.1", "Definitions", "", 3),
  doc("def-oef", "A.0.1.1.50", "Operational Executor Facilitator", "Operational Executor Facilitators interpret Artifacts on behalf of Operational Executor Agents.", 4, DEFINITIONS_SECTION_ID),
  doc("def-fac", "A.0.1.1.19", "Facilitator", "Facilitators are anonymous Alignment Conservers.", 4, DEFINITIONS_SECTION_ID),
  doc("def-ad", "A.0.1.1.18", "Aligned Delegate (AD)", "Aligned Delegates are recognised delegates.", 4, DEFINITIONS_SECTION_ID),
  doc("def-vp", "A.0.1.1.35", "Voting Power", "Voting Power is a concept, not a role.", 4, DEFINITIONS_SECTION_ID),
  doc("a17", "A.1.7", "Facilitators", "A type of Alignment Conserver.", 2),
  doc("a171", "A.1.7.1", "Operational Executor Facilitator", "Every Operational Executor Agent must have a Facilitator.", 3, "a17"),
  doc("amatsu", "A.6.1.2.1.1", "Operational Executor Facilitator", "The Operational Facilitator for Operational Executor Agent Amatsu is Endgame Edge.", 5),
  doc("cc1", "A.6.1.2.3.1", "Operational Executor Facilitator", "The Facilitator for Core Council Executor Agent 1 is JanSky.", 5),
  doc("vp", "A.1.4.2", "Voting Power Rules", "Rules.", 3),
];
const GLOSSARY: Glossary = { "aligned delegate": [g("Aligned Delegate (AD)", "def-ad")], ad: [g("Aligned Delegate (AD)", "def-ad")] };
const ix = buildIndexes(DOCS, [], [], {}, null, GLOSSARY);
const roles = roleCatalog(ix);

describe("roleCatalog", () => {
  it("keeps Definitions entries that name a role and skips concept terms", () => {
    expect(roles.map((r) => r.name).sort()).toEqual(["Aligned Delegate", "Facilitator", "Operational Executor Facilitator"]);
  });
  it("derives the interior-word-dropped alias and glossary aliases", () => {
    const oef = roles.find((r) => r.name === "Operational Executor Facilitator")!;
    expect(oef.phrases.map((p) => p.join(" "))).toContain("operational facilitator");
    const ad = roles.find((r) => r.name === "Aligned Delegate")!;
    expect(ad.phrases.map((p) => p.join(" "))).toContain("ad");
  });
});

describe("matchRoles", () => {
  it("matches the atlas's own abbreviation, plural-tolerant, and lets the longer phrase claim its tokens", () => {
    const hit = matchRoles(roles, "How are Operational Facilitators rewarded, and who signs off on the budget?");
    expect(hit.map((r) => r.name)).toEqual(["Operational Executor Facilitator"]); // not also the bare "Facilitator"
  });
  it("matches the generic role on its own", () => {
    expect(matchRoles(roles, "who is the facilitator for Ozone").map((r) => r.name)).toEqual(["Facilitator"]);
  });
  it("names nothing on a question without a role", () => {
    expect(matchRoles(roles, "what is the stability fee")).toEqual([]);
    expect(rolesFact.run({ ix, question: "what is voting power" })!.count).toBe(0);
  });
});

describe("roleDossier", () => {
  const d = roleDossier(ix, roles.find((r) => r.name === "Operational Executor Facilitator")!);
  it("carries the definition, the role family article, every role-titled doc and the named holders", () => {
    expect(d.definition.doc_id).toBe("def-oef");
    expect(d.family_docs.map((x) => x.doc_id)).toEqual(["a17"]);
    expect(d.titled_docs.map((x) => x.doc_id)).toEqual(["a171", "amatsu", "cc1"]); // shallow first
    expect(d.holders.map((h) => h.statement)).toEqual([
      "The Operational Facilitator for Operational Executor Agent Amatsu is Endgame Edge.",
    ]);
  });
  it("the generic role's holders include qualified statements", () => {
    const f = roleDossier(ix, roles.find((r) => r.name === "Facilitator")!);
    expect(f.holders.map((h) => h.doc_id).sort()).toEqual(["amatsu", "cc1"]);
  });
});
