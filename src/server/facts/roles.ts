// The role fact: when a question names a defined role — "Operational
// Facilitator", "Aligned Delegates", "Core GovOps" — inject that role's dossier:
// its Definitions entry, every document TITLED with the role, the role family's
// Article/Section, and any "The <role> for X is Y" assignment. Deterministic
// and cheap, like every fact: pure lookups over the served index, no model call.
//
// Why it exists (2026-09-10): "How are Operational Facilitators rewarded, and
// who signs off on the budget?" is one of the panel's example questions. Ranked
// search on that phrasing returns the eight identical "Root Edit Proposal Review
// By Operational Facilitator" process docs and never A.1.7.1 (the section that
// answers it), nor A.6.1.2.1.1 / A.6.1.2.2.1 (the docs that say who holds the
// role). The glossary fact missed too: the atlas defines "Operational Executor
// Facilitator" but calls the holder "the Operational Facilitator" in its own
// artifact text, so the question's phrase is an interior-word-dropped alias of
// the definition title. This fact matches that shape on purpose.
import type { Fact } from "./types.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import type { AtlasNode } from "../retrieval/indexes.ts";

// A.0.1.1 — the Atlas Preamble's Definitions section. UUID, not doc_no.
export const DEFINITIONS_SECTION_ID = "c7d62f28-1d64-4632-8cd8-4f2b44c51bba";

// A Definitions entry is a ROLE when its title ends in one of these. Every
// defined role in the atlas today ends this way (Facilitator, GovOps, Agent,
// Delegate, Conserver, Council, Foundation); a concept term ("Voting Power",
// "Endgame State") does not, and gets the glossary fact instead.
const ROLE_NOUNS = new Set(["facilitator", "govops", "agent", "delegate", "conserver", "council", "foundation"]);
const MAX_ROLES = 3;
const MAX_TITLED = 12;
const MAX_HOLDERS = 8;
const SNIPPET = 240;
const DEFINITION_MAX = 700;

const words = (t: string): string[] => t.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [];
const singular = (w: string) => (w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const stripParen = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, "").trim();

export interface Role {
  doc: AtlasNode;
  name: string; // definition title, parenthetical alias stripped
  phrases: string[][]; // token phrases that name it, longest first
}

// Phrases that name a role: the title itself, glossary aliases pointing at the
// same doc ("AD" for Aligned Delegate), and — for 3+ word titles — the title
// with ONE interior word dropped ("Operational Executor Facilitator" →
// "Operational Facilitator"), which is how the atlas itself abbreviates holders.
export function roleCatalog(ix: Indexes): Role[] {
  const out: Role[] = [];
  for (const doc of ix.childrenIndex.get(DEFINITIONS_SECTION_ID) ?? []) {
    const name = stripParen(doc.title);
    const base = words(name);
    if (base.length === 0 || !ROLE_NOUNS.has(base[base.length - 1])) continue;
    const phrases: string[][] = [base];
    if (base.length >= 3) for (let i = 1; i < base.length - 1; i++) phrases.push([...base.slice(0, i), ...base.slice(i + 1)]);
    for (const [key, entries] of ix.glossary) if (entries.some((e) => e.nodeId === doc.id)) phrases.push(words(key));
    const uniq = [...new Map(phrases.filter((p) => p.length > 0).map((p) => [p.join(" "), p])).values()];
    out.push({ doc, name, phrases: uniq.sort((a, b) => b.length - a.length) });
  }
  return out;
}

// Which roles the question names. Contiguous token match, plural-tolerant on
// the last word, longest phrase first with consumed tokens — so "Operational
// Facilitators" claims its tokens before the one-word "Facilitator" can.
export function matchRoles(roles: Role[], question: string): Role[] {
  const toks = words(question);
  const consumed = new Array<boolean>(toks.length).fill(false);
  const candidates = roles
    .flatMap((r) => r.phrases.map((p) => ({ r, p })))
    .sort((a, b) => b.p.length - a.p.length);
  const hit = new Map<string, Role>();
  for (const { r, p } of candidates) {
    for (let i = 0; i + p.length <= toks.length; i++) {
      if (consumed.slice(i, i + p.length).some(Boolean)) continue;
      const ok = p.every((w, j) => {
        const t = toks[i + j];
        return t === w || (j === p.length - 1 && singular(t) === w);
      });
      if (!ok) continue;
      consumed.fill(true, i, i + p.length);
      hit.set(r.doc.id, r);
    }
  }
  return [...hit.values()].slice(0, MAX_ROLES);
}

const row = (d: AtlasNode) => ({ doc_id: d.id, doc_no: d.doc_no, title: d.title });
const snippet = (d: AtlasNode) => (d.content.length > SNIPPET ? `${d.content.slice(0, SNIPPET)}…` : d.content);

export function roleDossier(ix: Indexes, role: Role) {
  const phraseRes = role.phrases.map((p) => new RegExp(`\\b${p.join("\\s+")}s?\\b`, "i"));
  const family = words(role.name).at(-1)!;
  const titled: AtlasNode[] = [];
  const familyDocs: AtlasNode[] = [];
  const holders: { doc_id: string; doc_no: string; statement: string }[] = [];
  for (const d of ix.docMap.values()) {
    if (d.id === role.doc.id) continue;
    if (phraseRes.some((re) => re.test(d.title))) titled.push(d);
    else if (d.depth <= 3 && singular(d.title.toLowerCase()) === family) familyDocs.push(d);
    // Up to two qualifying words may precede the role ("The Operational
    // Facilitator for … is …" still names a holder of the generic Facilitator role).
    const m = d.content.match(new RegExp(`^The (?:[A-Z][\\w-]* ){0,2}(?:${role.phrases.map((p) => p.join("\\s+")).join("|")}) for (.+?) is (.+?)\\.$`, "im"));
    if (m && holders.length < MAX_HOLDERS) holders.push({ doc_id: d.id, doc_no: d.doc_no, statement: m[0] });
  }
  const byPlace = (a: AtlasNode, b: AtlasNode) => a.depth - b.depth || a.order - b.order;
  return {
    role: role.name,
    definition: { ...row(role.doc), content: role.doc.content.length > DEFINITION_MAX ? `${role.doc.content.slice(0, DEFINITION_MAX)}…` : role.doc.content },
    family_docs: familyDocs.sort(byPlace).slice(0, 3).map((d) => ({ ...row(d), snippet: snippet(d) })),
    titled_docs: titled.sort(byPlace).slice(0, MAX_TITLED).map((d) => ({ ...row(d), snippet: snippet(d) })),
    holders,
  };
}

export const ROLES_NOTE =
  "Role dossiers for roles the question names: the Definitions entry, the role family's Article/Section, every document TITLED with the role " +
  "(rules about the role live under these — atlas_get one before quoting it; snippets are openings, not full text), and any 'The <role> for X is Y' " +
  "assignment naming who holds it. If none of these answers the question, say what they do establish and that the atlas records nothing further.";

export const rolesFact: Fact = {
  id: "roles",
  what: "Role dossier (definition, role-titled docs, family article, named holders) for each defined role the question names, alias- and plural-tolerant.",
  summarize: (n) => `${n} role dossier${n === 1 ? "" : "s"}`,
  run: ({ ix, question }) => {
    const roles = matchRoles(roleCatalog(ix), question);
    const rows = roles.map((r) => roleDossier(ix, r));
    return { key: "roles", value: rows, note: ROLES_NOTE, count: rows.length };
  },
};
