/**
 * Pure predicate functions, regexes, and content-extraction helpers for
 * pattern-driven graph extraction.
 */

import crypto from "node:crypto";

export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Deterministic, v4-shaped UUID derived from an entity slug. The same slug
// always yields the same id, so entities created in different build phases
// reconcile to one node. This is the entity-identity primitive for the whole
// graph — keep it the single definition.
export function slugToId(slug) {
  const h = crypto.createHash("sha256").update(slug).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Build an entity record with the canonical field shape. Callers own their own
// get-or-create guard and registry bookkeeping (entityMap / entityById); this
// only constructs the object so the shape can't drift between phases.
export function makeEntity(slug, name, entity_type, { subtype, defining_doc_id, is_active = 1, meta } = {}) {
  return {
    id: slugToId(slug),
    slug,
    name,
    entity_type,
    subtype: subtype ?? null,
    defining_doc_id: defining_doc_id ?? null,
    is_active,
    meta: meta ? JSON.stringify(meta) : null,
  };
}

// ---------------------------------------------------------------------------
// Pattern matchers (doc_no / title-based; no hardcoded names)
// ---------------------------------------------------------------------------

export const isPrimeAgent = (d) => /^A\.6\.1\.1\.\d+$/.test(d.doc_no);
export const isExecutorAgent = (d) => /^A\.6\.1\.2\.\d+$/.test(d.doc_no);
export const isFacilitatorDoc = (d) => /^A\.6\.1\.2\.\d+\.1$/.test(d.doc_no);
export const isGovOpsDoc = (d) => /^A\.6\.1\.2\.\d+\.2$/.test(d.doc_no);
export const isActiveData = (d) => /\.0\.6\.\d+$/.test(d.doc_no);
export const isAnnotation = (d) => /\.(0\.[34]|\d+\.var\d+)(\.\d+)?$/.test(d.doc_no);
export const isEcosystemAccord = (d) => /^A\.2\.8\.2\.\d+$/.test(d.doc_no);
export const isPartyDetails = (d) => /^A\.2\.8\.2\.\d+\.1\.1\.\d+$/.test(d.doc_no);
export const isGrantDoc = (d) => /^A\.2\.13\.1\.\d+\.\d+$/.test(d.doc_no);
export const isICDLocation = (d) =>
  /instance configuration document location/i.test(d.title) ||
  /^\s*This Instance[’']s associated Instance Configuration Document is located at/i.test(
    d.content ?? "",
  );
export const isICD = (d) => /instance configuration document/i.test(d.title) && !isICDLocation(d);
export const isGlobalActivationStatus = (d) => /global activation status/i.test(d.title);

// Registry docs are anchored by UUID, never doc_no — atlas renumbering moved
// these from A.1.5.*/A.1.8.* to A.1.6.*/A.1.9.* (silently breaking the old
// doc_no constants). Doc_nos for source citations are derived at runtime.
export const ERG_MEMBERSHIP_UUID = "e9807449-fdc3-4860-8d53-c56181311618"; // A.1.9.1.2.2.0.6.1
export const ALIGNED_DELEGATES_UUID = "5f584db8-f8d8-4118-988c-b2bc3f68ceb7"; // A.1.6.1.5.0.6.1
// "Current Level N Ranked Delegates" docs (Pattern 10).
export const RANKED_DELEGATE_UUIDS = new Map([
  [1, "46c0f334-4421-4e1a-9130-501e3a246e2a"], // A.1.6.4.1.1.3.1
  [2, "ebe4da3b-2674-4ee1-b7a8-3d7a4b37fe75"], // A.1.6.4.1.2.3.1
]);
// "Spell Team Configuration" — names the rotating spell crafting/reviewing teams.
export const SPELL_TEAM_UUID = "4862ed4e-097b-42fa-a197-1d407d220a77"; // A.1.10.2.2.2.1

// A.1.7.1 — "Active Ecosystem Actors" section. Each direct child is a role
// definition doc; its .2 child is the "Designated X" binding doc that names
// the holder. Walk from here to discover all role bindings automatically.
export const ACTIVE_ECOSYSTEM_ACTORS_UUID = "1ef5767b-60bc-446a-af45-4eccdb20c023";

// Structural anchor: the first known binding doc. Used as a sanity check
// that the A.1.7.1 walk is still finding the right section.
export const CCRA_BINDING_UUID = "51b1fe46-2251-4078-a805-e2b40aaaf729";

export const UUID_LINK_RE =
  /\[([^\]]*)\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
export const COMPRISES_RE = /The party ['‘]([^'’]+)['’] comprises\s+(.+?)\./i;
// Atomic parties use a different sentence shape — "The party 'X' is <descriptor>."
// (e.g. A.2.8.2.2.1.1.4 Moonbow: "…is the entity owning relevant intellectual
// property."). The party still signs the accord, it just has no members to list.
export const ATOMIC_PARTY_RE = /The party ['‘]([^'’]+)['’]\s+is\b/i;

// ---------------------------------------------------------------------------
// Entity name resolution helpers
// ---------------------------------------------------------------------------

// Collapse a name to a comparison key: "Soter Labs" / "SoterLabs" / "soter-labs"
// all → "soterlabs". Used to match registry-table names and prose mentions
// against existing entities whose casing/punctuation differs.
export function normalizeKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Build a normalizeKey → entity lookup over the current entityMap (names and
// slugs both indexed; first writer wins so Phase-1 entities take precedence).
export function buildNameIndex(entityMap) {
  const index = new Map();
  for (const e of entityMap.values()) {
    for (const key of [normalizeKey(e.name), normalizeKey(e.slug)]) {
      if (key && !index.has(key)) index.set(key, e);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Content extraction helpers
// ---------------------------------------------------------------------------

// Extract "X is Y." or "X is the Y." from content
export function extractAssignment(content, prefix) {
  const re = new RegExp(prefix + "\\s+is\\s+(?:the\\s+)?([^.\\[]+)\\.", "i");
  const m = content?.match(re);
  return m ? m[1].trim() : null;
}

// Active Data Controllers declare a Responsible Party in one of two forms:
//   "The Responsible Party is <role/name>."
//   "Responsible Party: <role/name>."
// The value may be a role alone ("Operational GovOps"), a named entity alone
// ("Soter Labs"), or role+name ("Operational GovOps Soter Labs"). Role-only
// declarations are resolved via the entity chain at edge-emission time.
const RP_RE_IS = /(?:The\s+)?Responsible Party\s+is\s+(?:the\s+)?([^.[\n]+?)\s*\./i;
const RP_RE_COLON = /Responsible Party:\s*([^\n]+?)\s*(?:\.\s*$|\.(?=\s|\n)|$)/im;
const RP_ROLES = [
  { re: /^Operational GovOps\b\s*/i, key: "operational_govops" },
  { re: /^Core GovOps\b\s*/i, key: "core_govops" },
  { re: /^Operational Facilitator\b\s*/i, key: "operational_facilitator" },
  { re: /^Core Facilitator\b\s*/i, key: "core_facilitator" },
  { re: /^Support Facilitators?\b\s*/i, key: "support_facilitators" },
];

export function extractRP(content) {
  if (!content) return null;
  return (content.match(RP_RE_IS)?.[1] ?? content.match(RP_RE_COLON)?.[1] ?? "").trim() || null;
}

// Process-step "Update" docs (type=Core, mostly A.2.2.9.*) carry the same
// "Responsible Party:" bulleted field as ADCs, but a doc may carry SEVERAL
// steps each with their own declaration — unlike extractRP (one declaration
// per ADC), every occurrence must be seen.
const STEP_RP_RE = /Responsible\s+Part(?:y|ies)\s*:\s*([^\n]+)/gi;

export function extractAllRP(content) {
  if (!content) return [];
  const out = [];
  for (const m of content.matchAll(STEP_RP_RE)) {
    const raw = m[1].replace(/\.\s*$/, "").trim();
    if (raw) out.push(raw);
  }
  return out;
}

// Process-step RP declarations often carry an automation annotation —
// "[automated]", "[if not automated]" (negated — NOT automated), inconsistent
// internal spacing, and not necessarily at the end of the string. Detect
// (negation-aware) and strip it in one pass before role/name resolution; the
// caller keeps the raw, unstripped value for meta/provenance.
const AUTOMATION_BRACKET_RE = /\[([^\]]*)\]/g;

export function extractAutomation(raw) {
  let automated = false;
  const clean = raw
    .replace(AUTOMATION_BRACKET_RE, (whole, inner) => {
      if (!/automated/i.test(inner)) return whole;
      if (!/\bnot\b/i.test(inner)) automated = true;
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { clean, automated };
}

export function rpRoleAndName(raw) {
  // Defensive: the role is occasionally spelled without a space in prose
  // ("CoreGovOps"); normalize before matching so it isn't misread as a name.
  const normalized = raw.replace(/^(Operational|Core)(GovOps)\b/i, "$1 $2");
  for (const r of RP_ROLES) {
    if (r.re.test(normalized)) return { role: r.key, name: normalized.replace(r.re, "").trim() };
  }
  return { role: null, name: normalized };
}

// Parse a comma/and-separated list, stripping leading "the " / "and ".
export function parseNameList(str) {
  return str
    .split(/,\s*/)
    .flatMap((p) => p.split(/\s+and\s+/i))
    .map((s) =>
      s
        .trim()
        .replace(/^(?:the|and)\s+/i, "")
        .trim(),
    )
    .filter(Boolean);
}

// Extract list items from Active Data content (for ERG membership, delegate lists)
export function extractListItems(content) {
  return (
    (content ?? "")
      .split("\n")
      .filter((l) => /^[-*]\s+/.test(l.trim()))
      .map((l) =>
        l
          .trim()
          .replace(/^[-*]\s+/, "")
          .trim(),
      )
      // Strip "Recipient: X" or bullet labels; keep plain names.
      .map((l) => l.replace(/^Recipient:\s*/i, "").trim())
      .filter(Boolean)
  );
}

export function ancestorByStripping(doc, n, docByDocNo) {
  const parts = doc.doc_no.split(".");
  if (parts.length <= n) return null;
  return docByDocNo.get(parts.slice(0, -n).join(".")) ?? null;
}

// Resolve the Primitive root for any per-agent ICD. Primitive roots live at
// A.6.1.1.X.2.G.P (agent X → Sky Primitives section → primitive group G →
// primitive P). Every ICD lives under one of these, however deeply nested.
export function primitiveRootFor(doc, docByDocNo) {
  const m = doc.doc_no.match(/^(A\.6\.1\.1\.\d+\.2\.\d+\.\d+)(?:$|\.)/);
  if (!m) return null;
  const root = docByDocNo.get(m[1]);
  return root && /Primitive$/i.test(root.title) ? root : null;
}

