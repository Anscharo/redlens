// Deterministic censuses backing docs/crossview/concepts.md (the /reports/crossview
// Concepts tab). DOM-free pure compute over the docs bundle only — the
// crossviewShape.ts precedent — so it's importable both from the browser bundle
// (ConceptCensus.tsx) and from a bun-run script (check-concepts-census.mjs,
// the check-risk-census.mjs precedent). Every census here is mechanical
// (title pattern / content regex / structural emptiness / set difference) —
// per the admission rule in docs/plans (byte-reproducible ⇒ data, judgment ⇒
// curated prose), nothing here is LLM-derived and nothing here writes to
// relations.json.
//
// Interleaved into concepts.md via a `:::census <slug>` marker line — see
// CrossViewMarkdown.tsx / ConceptCensus.tsx.

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

// "Does ANY doc sit under this one" — sorted binary search over the doc_no
// list, built ONCE per sweep and shared by every census that asks. The naive
// `all.some(startsWith)` per candidate is quadratic and dominated this module:
// 1,136 candidates x 11,335 docs = 12.9M scans, ~150ms of the census pass.
// Exported because liveness.ts asks the same question of the same corpus in
// the same breath and must not build a second index (or a second algorithm).
// fragile: doc_no prefix — this asks about ANY descendant, never "is this
// specific doc X", so a renumbering moves a whole family together and the
// answer is unchanged. A parentId version would need a child-count index
// neither caller builds.
export function buildHasDescendant(all: AtlasNode[]): (doc_no: string) => boolean {
  const sorted = all.map((n) => n.doc_no).sort();
  return (doc_no: string) => {
    const prefix = `${doc_no}.`;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    return lo < sorted.length && sorted[lo].startsWith(prefix);
  };
}

// ---------------------------------------------------------------------------
// H1. registry-liveness — title prefix "List Of" + emptiness.
// ---------------------------------------------------------------------------
// Exported (unlike its nine siblings) so liveness.ts can run just the two
// censuses it consumes instead of the whole 10-bucket sweep on every boot and
// atlas hot-swap — same heuristics, one source of truth, ~2/3 less work.
export function censusRegistryLiveness(all: AtlasNode[], hasDescendant = buildHasDescendant(all)): CensusResult {
  const regs = all.filter((n) => /^List Of /.test(n.title));
  const members = regs.map((n) => {
    const live = hasDescendant(n.doc_no) || hasDataTable(n.content) || BULLET_LINE_RE.test(n.content);
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

// Exported for liveness.ts alongside censusRegistryLiveness — see the note there.
export function censusEmptyScaffolding(all: AtlasNode[], hasDescendant = buildHasDescendant(all)): CensusResult {
  const dirs = all.filter((n) => STATUS_DIR_RE.test(n.title));
  const members = dirs.map((n) => ref(n, hasDescendant(n.doc_no) ? "populated" : "empty"));
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

// Risk Capital — anchor by UUID, not the "A.3.2" doc_no literal (CLAUDE.md):
// a renumbering must not silently zero out this subtotal. The "A.3.2" COUNT
// KEY is kept as-is (not renamed to e.g. "risk-capital-subtree") because it's
// read literally by .github/concepts-census-baseline.json and by concepts.md's
// own prose — renaming it would be baseline/doc churn for no behavior change.
const RISK_CAPITAL_UUID = "55999acf-75fe-4adf-8584-9746ef50d3e4"; // A.3.2 Risk Capital

function censusFormulaDocs(all: AtlasNode[]): CensusResult {
  const members = all.filter((n) => FORMULA_RE.test(n.content)).map((n) => ref(n));
  const riskCapital = all.find((n) => n.id === RISK_CAPITAL_UUID);
  const inRiskCapital = riskCapital
    ? members.filter((m) => m.doc_no === riskCapital.doc_no || m.doc_no.startsWith(`${riskCapital.doc_no}.`)).length
    : 0;
  return {
    slug: "formula-docs",
    title: "Formulas (mathematical definitions)",
    signature: { kind: "content", pattern: "content contains \\frac, \\sum, \\times, or \\text{" },
    members,
    counts: { total: members.length, "A.3.2": inRiskCapital },
    notes: riskCapital
      ? "concepts.md's original figure was 120 docs (54 in A.3.2, atlas db87434); the current atlas (checked-out submodule) shows fewer outside A.3.2 — the A.3.2 share still matches exactly, so this reads as remainder drift, not a signature bug. Re-verify if the corpus-wide total keeps falling."
      : "Risk Capital (A.3.2) node not found by UUID in this bundle — the A.3.2 subtotal has degraded to 0 rather than silently mismatching a stale doc_no prefix.",
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
// Dn2–Dn9. normative-title-families — the census-first re-derivation of the
// normative-family taxonomy in concepts.md's D section. Each bucket is one
// title regex; a doc matching two buckets is counted in both (overlap is the
// point — derecognition-for-opsec-breach docs are genuinely both).
// ---------------------------------------------------------------------------
// Lifecycle status-bucket directories ("Suspended Instances") are scaffolding
// for the primitive machine (B group / empty-scaffolding census), not norms —
// excluded from the suspension bucket, which is what the pre-rewrite Dn3
// signature accidentally counted.
const STATUS_BUCKET_RE = /^(Suspended|Active|Completed|In[- ]Progress|Failed|Archived) (Instances?|Invocations?)( Directory)?$/i;

const NORMATIVE_TITLE_FAMILIES: [string, (title: string) => boolean][] = [
  ["prohibition", (t) => /Prohibit/i.test(t)],
  ["derecognition", (t) => /Derecogni/i.test(t) || /^Swift Action/i.test(t)],
  ["suspension-rule", (t) => /Suspen/i.test(t) && !STATUS_BUCKET_RE.test(t)],
  ["operational-conduct", (t) => /Operational Security/i.test(t) || /Err On (The )?Side Of Caution/i.test(t)],
  ["adjudication", (t) => /Adjudicat/i.test(t) || /Standard of Proof/i.test(t)],
  ["alignment", (t) => /Universal Alignment/i.test(t) || /Misalign/i.test(t)],
  ["edit-restriction", (t) => /Edit Restrictions?\b/i.test(t)],
];

function censusNormativeTitleFamilies(all: AtlasNode[]): CensusResult {
  const members: CensusMember[] = [];
  const counts: Record<string, number> = {};
  for (const [bucket, test] of NORMATIVE_TITLE_FAMILIES) {
    const matches = all.filter((n) => test(n.title));
    counts[bucket] = matches.length;
    for (const n of matches) members.push(ref(n, bucket));
  }
  const distinct = new Set(members.map((m) => m.uuid)).size;
  return {
    slug: "normative-title-families",
    title: "Normative title families (Norms 2–9)",
    signature: {
      kind: "title",
      pattern:
        'title matches one of: /Prohibit/ · /Derecogni/ or "Swift Action…" · /Suspen/ minus lifecycle status buckets · /Operational Security/ or "Err On Side Of Caution" · /Adjudicat/ or "Standard of Proof" · /Universal Alignment/ or /Misalign/ · /Edit Restriction/',
    },
    members,
    counts: { total: members.length, distinct, ...counts },
    notes:
      "Buckets overlap by design (e.g. \"Derecognition Required Where AD Operational Security Is Compromised\" is both derecognition and operational-conduct), so total > distinct. Title-only: it finds the docs the Atlas *names* after a normative family, not every doc that carries the norm — the duty layer (Norms 1) is edge-derived (duty_for in relations.json) and deliberately not censused here, which is docs-bundle-only.",
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
    notes: 'Census tier only, deliberately not a graph edge — title identity is a lead, not a verified relation (can\'t distinguish "same object, two views" from "same template, different subjects"). Expect some template-title noise ("Scope", "In General", "Resources") alongside real exemplars (SkyLink Freezer Multisigs, "Role Of Core Facilitator").',
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
  "normative-title-families",
  "cross-scope-duplication",
] as const;
export type CensusSlug = (typeof CENSUS_SLUGS)[number];

export function computeConceptsCensus(docs: Record<string, AtlasNode>): Record<CensusSlug, CensusResult> {
  const all = Object.values(docs);
  const hasDescendant = buildHasDescendant(all);
  return {
    "registry-liveness": censusRegistryLiveness(all, hasDescendant),
    "empty-scaffolding": censusEmptyScaffolding(all, hasDescendant),
    "ghost-doc-types": censusGhostDocTypes(all),
    "transitionary-measures": censusTransitionaryMeasures(all),
    "formula-docs": censusFormulaDocs(all),
    "numbered-step-docs": censusNumberedStepDocs(all),
    "prohibition-language": censusProhibitionLanguage(all),
    "title-templates": censusTitleTemplates(all),
    "normative-title-families": censusNormativeTitleFamilies(all),
    "cross-scope-duplication": censusCrossScopeDuplication(all),
  };
}
