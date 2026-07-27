// Deterministic censuses backing docs/library/concepts.md (the /reports/library
// Concepts tab). DOM-free pure compute over the docs bundle only — the
// libraryShape.ts precedent — so it's importable both from the browser bundle
// (ConceptCensus.tsx) and from a bun-run script (check-concepts-census.mjs,
// the check-risk-census.mjs precedent). Every census here is mechanical
// (title pattern / content regex / structural emptiness / set difference) —
// per the admission rule in docs/plans (byte-reproducible ⇒ data, judgment ⇒
// curated prose), nothing here is LLM-derived and nothing here writes to
// relations.json.
//
// Interleaved into concepts.md via a `:::census <slug>` marker line — see
// LibraryMarkdown.tsx / ConceptCensus.tsx.

import type { AtlasNode } from "../types";

export interface CensusMember {
  uuid: string;
  doc_no: string;
  title: string;
  /** Sub-bucket label for censuses with more than one outcome (e.g. "live"/"empty"). */
  bucket?: string;
}

export interface CensusResult {
  slug: string;
  title: string;
  signature: { kind: "title" | "content" | "structural" | "set-diff"; pattern: string };
  members: CensusMember[];
  counts: Record<string, number>;
  notes?: string;
}

const ref = (n: AtlasNode, bucket?: string): CensusMember => ({
  uuid: n.id,
  doc_no: n.doc_no,
  title: n.title,
  ...(bucket ? { bucket } : {}),
});

// ---------------------------------------------------------------------------
// hasDataTable — mirrors scripts/lib/census-fingerprint.mjs's hasDataTable.
// Duplicated (not imported) because this module must stay DOM-free and
// importable from both the browser bundle and a bun-run script, and the .mjs
// sibling can't be imported from browser-bundled TS. Keep the two in sync —
// see census-fingerprint.mjs's own comment pointing back here.
// ---------------------------------------------------------------------------
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|[\s:|-]+\|\s*$/;

export function hasDataTable(content: string): boolean {
  const rows = content.split("\n").filter((l) => TABLE_ROW_RE.test(l));
  if (rows.length < 3) return false;
  return rows.filter((l) => !TABLE_SEP_RE.test(l)).length >= 2;
}

// A registry/directory doc's own body is a bare pointer sentence with nothing
// after it ("The current Active Integrators are:") when genuinely empty;
// real entries show up as at least one bullet line.
const BULLET_LINE_RE = /^\s*[-*]\s+\S/m;

function hasDescendant(doc_no: string, all: AtlasNode[]): boolean {
  const prefix = `${doc_no}.`;
  return all.some((n) => n.doc_no.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// H1. registry-liveness — title prefix "List Of" + emptiness.
// ---------------------------------------------------------------------------
function censusRegistryLiveness(all: AtlasNode[]): CensusResult {
  const regs = all.filter((n) => /^List Of /.test(n.title));
  const members = regs.map((n) => {
    const live = hasDescendant(n.doc_no, all) || hasDataTable(n.content) || BULLET_LINE_RE.test(n.content);
    return ref(n, live ? "live" : "empty");
  });
  const live = members.filter((m) => m.bucket === "live").length;
  return {
    slug: "registry-liveness",
    title: 'Registries ("List Of …") — live vs empty shell',
    signature: { kind: "structural", pattern: 'title prefix "List Of " + (has descendant docs OR a data table OR ≥1 bullet entry)' },
    members,
    counts: { total: members.length, live, empty: members.length - live },
  };
}

// ---------------------------------------------------------------------------
// B3. empty-scaffolding — status-bucket directory titles × zero children.
// ---------------------------------------------------------------------------
const STATUS_DIR_RE = /^(Active|Completed|In[- ]Progress|Suspended|Failed|Archived) (Instances?|Invocations?)( Directory)?$/i;

function censusEmptyScaffolding(all: AtlasNode[]): CensusResult {
  const dirs = all.filter((n) => STATUS_DIR_RE.test(n.title));
  const members = dirs.map((n) => ref(n, hasDescendant(n.doc_no, all) ? "populated" : "empty"));
  const empty = members.filter((m) => m.bucket === "empty").length;
  return {
    slug: "empty-scaffolding",
    title: "Instance status-bucket directories that are empty scaffolding",
    signature: { kind: "structural", pattern: 'title "(Active|Completed|In-Progress|Suspended|Failed|Archived) (Instances|Invocations)[ Directory]" + zero children' },
    members,
    counts: { total: members.length, empty, populated: members.length - empty },
    notes: "One directory per primitive instance/invocation lifecycle bucket — high empty rate is expected (most buckets are scaffolding for a state that hasn't happened yet), not itself a staleness signal per bucket.",
  };
}

// ---------------------------------------------------------------------------
// A1. ghost-doc-types — set difference: registry-spec'd type names vs the
// `type:` values actually occurring on real docs.
// ---------------------------------------------------------------------------
// Anchor: A.1.2.2.2 "List Of Document Types And Their Specifications" — its
// direct children are "The <Name> Type" Type Specification docs (30 in the
// corpus at authoring time). UUID-anchored per CLAUDE.md's doc_no rules.
const TYPE_REGISTRY_UUID = "428b7f2e-30b0-4119-a10a-9c3496f19bd2"; // A.1.2.2.2
// Registry type names whose corresponding `type:` field value uses different
// wording — hand-verified aliases, not a guess (Facilitator-prefixed variants
// collapse to the plain structural type; the Preamble uses the Scope type).
const TYPE_ALIASES: Record<string, string> = {
  "Facilitator Action Tenet": "Action Tenet",
  "Facilitator Scenario": "Scenario",
  "Element Annotation": "Annotation",
  "Atlas Preamble": "Scope",
};

function censusGhostDocTypes(all: AtlasNode[]): CensusResult {
  const occurring = new Set(all.map((n) => n.type));
  const registry = all.find((n) => n.id === TYPE_REGISTRY_UUID);
  const specs = registry ? all.filter((n) => n.doc_no.startsWith(`${registry.doc_no}.`) && n.type === "Type Specification") : [];
  const members = specs.map((n) => {
    const m = /^The (.+) Type$/.exec(n.title.trim());
    const name = m ? m[1] : n.title;
    const resolved = TYPE_ALIASES[name] ?? name;
    return ref(n, occurring.has(resolved) ? "used" : "ghost");
  });
  const ghost = members.filter((m) => m.bucket === "ghost").length;
  return {
    slug: "ghost-doc-types",
    title: "Spec'd-but-unrealized document types (the ghost layer)",
    signature: { kind: "set-diff", pattern: 'children of A.1.2.2.2 "The <Name> Type" vs the set of `type:` values actually occurring on real docs (alias-corrected for Facilitator-prefixed/Preamble naming)' },
    members,
    counts: { total: members.length, used: members.length - ghost, ghost },
    notes: "Directory-wrapper type specs (e.g. \"Budget Directory\") have no dedicated `type:` value by construction and always land in 'ghost' alongside genuinely unpopulated types — both read as spec'd-but-unrealized for this purpose.",
  };
}

// ---------------------------------------------------------------------------
// D10. transitionary-measures — title regex.
// ---------------------------------------------------------------------------
const TRANSITIONARY_RE = /Transitionary Measures?/i;

function censusTransitionaryMeasures(all: AtlasNode[]): CensusResult {
  const members = all.filter((n) => TRANSITIONARY_RE.test(n.title)).map((n) => ref(n));
  return {
    slug: "transitionary-measures",
    title: "Short-Term Transitionary Measures",
    signature: { kind: "title", pattern: 'title contains "Transitionary Measure(s)"' },
    members,
    counts: { total: members.length },
  };
}

// ---------------------------------------------------------------------------
// E3. formula-docs — content carries LaTeX math.
// ---------------------------------------------------------------------------
// Exactly the four sample commands named in concepts.md's signature. A
// broader "any $…$ delimiter" variant was tried and rejected: it pulls in
// A.3.2's many single-variable notation defs ("$PD$", "$r_c^i$" — glossary
// entries, not formulas), pushing the A.3.2 share from an exact match against
// concepts.md's stated 54 up to 99/117 — a different, less faithful profile.
// This narrower regex reproduces the 54-in-A.3.2 figure exactly; see the
// notes field for the corpus-wide total's drift from concepts.md's 120.
const FORMULA_RE = /\\frac|\\sum|\\times|\\text\{/;

function censusFormulaDocs(all: AtlasNode[]): CensusResult {
  const members = all.filter((n) => FORMULA_RE.test(n.content)).map((n) => ref(n));
  const inA32 = members.filter((m) => m.doc_no.startsWith("A.3.2")).length;
  return {
    slug: "formula-docs",
    title: "Formulas (mathematical definitions)",
    signature: { kind: "content", pattern: "content contains \\frac, \\sum, \\times, or \\text{" },
    members,
    counts: { total: members.length, "A.3.2": inA32 },
    notes: "concepts.md's original figure was 120 docs (54 in A.3.2, atlas db87434); the current atlas (checked-out submodule) shows fewer outside A.3.2 — the A.3.2 share still matches exactly, so this reads as remainder drift, not a signature bug. Re-verify if the corpus-wide total keeps falling.",
  };
}

// ---------------------------------------------------------------------------
// C6. numbered-step-docs — content is a literal numbered sequence.
// ---------------------------------------------------------------------------
function hasNumberedSteps(content: string): boolean {
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = 0; i < lines.length; i++) {
    if (!/^1\.\s+\S/.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^2\.\s+\S/.test(lines[j])) return true;
      if (/^\d+\.\s+\S/.test(lines[j])) break; // a different number intervened — not sequential
    }
  }
  return false;
}

function censusNumberedStepDocs(all: AtlasNode[]): CensusResult {
  const members = all.filter((n) => hasNumberedSteps(n.content)).map((n) => ref(n));
  return {
    slug: "numbered-step-docs",
    title: "Numbered step procedures (raw)",
    signature: { kind: "content", pattern: 'content contains a "1." line followed later by a "2." line with no other number in between' },
    members,
    counts: { total: members.length },
    notes: "Feeds the processes-triage backlog (public/processes.json) — not every member is itself a curated process.",
  };
}

// ---------------------------------------------------------------------------
// D0/Dn2. prohibition-language — content keywords.
// ---------------------------------------------------------------------------
const PROHIBITION_RE = /\bprohibit(?:ed|s|ion)?\b|\bforbidden\b|\bnot permitted\b|\bmay not\b/i;

function censusProhibitionLanguage(all: AtlasNode[]): CensusResult {
  const members = all.filter((n) => PROHIBITION_RE.test(n.content)).map((n) => ref(n));
  return {
    slug: "prohibition-language",
    title: "Prohibition language",
    signature: { kind: "content", pattern: 'content contains "prohibit(ed/s/ion)", "forbidden", "not permitted", or "may not"' },
    members,
    counts: { total: members.length },
    notes: "Low-precision: keyword matching over-includes incidental uses (e.g. quoting a rule to explain an exception) alongside true prohibitions.",
  };
}

// ---------------------------------------------------------------------------
// F2/H1 exemplar. title-templates — exact-title census per family.
// ---------------------------------------------------------------------------
// A representative sample of the exact-title families cited in concepts.md's
// B/E groups (not exhaustive — new families are added as concepts.md cites them).
const TITLE_TEMPLATES: [string, string][] = [
  ["Primitive Hub Document", "Primitive Hub Document"],
  ["Global Activation Status", "Global Activation Status"],
  ["Hub Data Repository", "Hub Data Repository"],
  ["Single Instance Configuration Document", "Single Instance Configuration Document"],
  ["Parameters", "Parameters"],
  ["Rate Limits", "Rate Limits"],
  ["Initial Planning", "Initial Planning"],
  ["Operational GovOps Review", "Operational GovOps Review"],
  ["Artifact Edit Proposal", "Artifact Edit Proposal"],
  ["Omni Documents", "Omni Documents"],
];

function censusTitleTemplates(all: AtlasNode[]): CensusResult {
  const members: CensusMember[] = [];
  const counts: Record<string, number> = {};
  for (const [bucket, exact] of TITLE_TEMPLATES) {
    const matches = all.filter((n) => n.title === exact);
    counts[bucket] = matches.length;
    for (const n of matches) members.push(ref(n, bucket));
  }
  return {
    slug: "title-templates",
    title: "Exact-title document families",
    signature: { kind: "title", pattern: "exact title match against a curated family list" },
    members,
    counts: { total: members.length, ...counts },
    notes: "A representative sample of the families cited in concepts.md, not an exhaustive title-template catalog.",
  };
}

// ---------------------------------------------------------------------------
// II.6. cross-scope-duplication — identical normalized title, different scopes.
// ---------------------------------------------------------------------------
function scopeOf(doc_no: string): string {
  const m = /^A\.(\d+)/.exec(doc_no);
  if (m) return `A.${m[1]}`;
  return doc_no.startsWith("NR") ? "NR" : "?";
}

function censusCrossScopeDuplication(all: AtlasNode[]): CensusResult {
  const byTitle = new Map<string, AtlasNode[]>();
  for (const n of all) {
    const key = n.title.trim().toLowerCase();
    const arr = byTitle.get(key) ?? [];
    arr.push(n);
    byTitle.set(key, arr);
  }
  const members: CensusMember[] = [];
  let pairCount = 0;
  for (const [key, arr] of byTitle) {
    if (arr.length < 2 || arr.length > 3) continue; // total occurrence ≤ 3
    if (new Set(arr.map((n) => scopeOf(n.doc_no))).size < 2) continue; // different scopes required
    if (arr.some((n) => n.content.trim().length < 40)) continue; // both docs non-trivial
    pairCount++;
    for (const n of arr) members.push(ref(n, key));
  }
  return {
    slug: "cross-scope-duplication",
    title: "Cross-scope concept duplication (same title, parallel docs)",
    signature: { kind: "structural", pattern: "identical normalized title occurring 2–3 times total, spanning ≥2 scopes, all copies non-trivial (>40 chars)" },
    members,
    counts: { total: members.length, groups: pairCount },
    notes: 'Census tier only, deliberately not a graph edge — title identity is a lead, not a verified relation (can\'t distinguish "same object, two views" from "same template, different subjects"). Expect some template-title noise ("Scope", "In General", "Resources") alongside real exemplars (SkyLink Freezer Multisigs, "Swift Action…").',
  };
}

// ---------------------------------------------------------------------------
export const CENSUS_SLUGS = [
  "registry-liveness",
  "empty-scaffolding",
  "ghost-doc-types",
  "transitionary-measures",
  "formula-docs",
  "numbered-step-docs",
  "prohibition-language",
  "title-templates",
  "cross-scope-duplication",
] as const;
export type CensusSlug = (typeof CENSUS_SLUGS)[number];

export function computeConceptsCensus(docs: Record<string, AtlasNode>): Record<CensusSlug, CensusResult> {
  const all = Object.values(docs);
  return {
    "registry-liveness": censusRegistryLiveness(all),
    "empty-scaffolding": censusEmptyScaffolding(all),
    "ghost-doc-types": censusGhostDocTypes(all),
    "transitionary-measures": censusTransitionaryMeasures(all),
    "formula-docs": censusFormulaDocs(all),
    "numbered-step-docs": censusNumberedStepDocs(all),
    "prohibition-language": censusProhibitionLanguage(all),
    "title-templates": censusTitleTemplates(all),
    "cross-scope-duplication": censusCrossScopeDuplication(all),
  };
}
