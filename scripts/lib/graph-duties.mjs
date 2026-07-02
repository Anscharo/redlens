/**
 * GovOps duty discovery for build-graph section 2s-ter (duty_for edges).
 *
 * Scans doc titles + content for GovOps acting as an obligated or empowered
 * subject. Four match kinds, in priority order:
 *   title   — the doc title names GovOps (role containers like "Operational
 *             GovOps Review"); no quote, the frontend derives a snippet.
 *   active  — GovOps is the grammatical subject of an obligation/power verb.
 *   passive — GovOps is the agent of a passive ("must be approved by Core GovOps").
 *   phrase  — power idioms that carry no listed verb ("at the discretion of",
 *             "has the ability to", "is controlled by").
 *   org     — same active/passive scan keyed on a GovOps org's NAME (Atlas Axis
 *             drafts …); org names are resolved from the graph, never hardcoded.
 */

// "GovOps" as an actor. Guards, in order:
//  - not the consulted party ("in consultation with Core GovOps" — the subject
//    is whoever consults);
//  - not the noun compounds "GovOps meeting" / "govops channel" (Executive
//    Process venue names — the mandated actor there is the Governance Point).
const GOVOPS_SUBJ = String.raw`(?<!consultation\s+with\s+(?:the\s+)?(?:(?:Operational|Core)\s+)?)(?:(?:Operational|Core)\s+)?GovOps\b(?!\s+(?:meeting|channel)s?\b)`;

// Modals count as obligation markers, but not when they introduce a passive in
// which GovOps is the patient, not the actor: "items … during the GovOps
// meeting must be added", "Atlas Axis will be embedded". "will be able to" is
// not a passive — keep it.
const MODAL = String.raw`(?:must|shall|will|may|can|should)(?!\s+(?:not\s+)?be\s+\w+(?:ed|en)\b)`;

// Obligation/power verbs with GovOps as subject. "specified" is deliberately
// absent (cross-references read "… GovOps for Ozone are specified in A.6.1.2.2"
// — a doc pointer); its passive form lives in PASSIVE_VERBS where the "by"
// anchor guarantees an actor.
// The copula power forms allow one intervening adverb that isn't a negation:
// "is then empowered", "are jointly responsible" — but never "is not empowered".
const ACTIVE_VERBS = String.raw`reviews?|validates?|calculates?|executes?|performs?|(?:is|are)\s+(?:(?!not\b)\w+\s+)?(?:responsible|empowered|permitted|granted|authorized)|coordinates?|provides?|carries?\s+out|carry\s+out|takes?\s+over|take\s+over|confirms?|submits?|maintains?|monitors?|approves?|prepares?|publishes?|ensures?|manages?|oversees?|conducts?|handles?|assesses?|updates?|receives?|verif(?:y|ies)|makes?|creates?|records?|determines?|decides?|designates?|communicates?|notif(?:y|ies)|informs?|gives?|posts?|resolves?|arranges?|compiles?|mints?|shares?|drafts?|incorporates?|seizes?|imposes?|proposes?|escalates?|distributes?|disburses?|evaluates?`;

// Passive participles mirroring ACTIVE_VERBS plus by-anchored power forms
// (adjudicated/permitted/held/modified by GovOps). "controlled" is NOT here —
// bare "addresses controlled by GovOps" would pull in every multisig signer
// roster; the copula form below catches control of the multisig itself.
const PASSIVE_VERBS = String.raw`reviewed|validated|calculated|executed|performed|coordinated|provided|carried\s+out|taken\s+over|confirmed|submitted|maintained|monitored|approved|prepared|published|ensured|managed|overseen|conducted|handled|assessed|updated|received|verified|made|created|recorded|determined|decided|designated|communicated|notified|informed|given|posted|resolved|arranged|compiled|minted|shared|drafted|incorporated|seized|imposed|proposed|escalated|distributed|disbursed|evaluated|adjudicated|permitted|populated|modified|specified|initiated|held|granted|appointed|authorized|selected|chosen`;

export const ROLE_ACTION_RE = new RegExp(
  `${GOVOPS_SUBJ}[^.\\n]*?\\b(?:${MODAL}|${ACTIVE_VERBS})\\b`,
  "i",
);

export const PASSIVE_ROLE_ACTION_RE = new RegExp(
  `\\b(?:${PASSIVE_VERBS})\\b[^.\\n]*?\\bby\\s+(?:the\\s+)?(?:(?:Operational|Core)\\s+)?GovOps\\b(?!\\s+(?:meeting|channel)s?\\b)`,
  "i",
);

// Power idioms with no obligation verb.
export const PHRASE_RES = [
  // "may change at the discretion of Core GovOps"
  /\b(?:at|in)\s+(?:the|their|its)\s+(?:sole\s+)?discretion\s+of\s+(?:the\s+)?(?:(?:Operational|Core)\s+)?GovOps\b/i,
  // "Core GovOps … has the ability to modify / have full discretion to determine"
  new RegExp(`${GOVOPS_SUBJ}[^.\\n]*?\\b(?:has|have)\\b[^.\\n]*?\\b(?:discretion|authority|the\\s+ability)\\b`, "i"),
  // "The Operator Multisig is (jointly) controlled by Core GovOps"
  /\b(?:is|are)\s+(?:jointly\s+)?controlled\s+by\s+(?:the\s+)?(?:(?:Operational|Core)\s+)?GovOps\b/i,
];

// Title names GovOps as a topic-owner — but not the "GovOps Meeting" family,
// which describes an Executive Process venue run by the Governance Point.
export const TITLE_RE = /gov\s*ops(?!\s+(?:meeting|channel))/i;

const CORE_ROLE_RE = /\bCore\s*GovOps\b/i;
const OP_ROLE_RE = /\bOperational\s*GovOps\b/i;

// The atlas occasionally spells the role without a space ("CoreGovOps reviews").
export function normalizeGovOpsSpelling(text) {
  return text.replace(/\b(Operational|Core)(GovOps)\b/g, "$1 $2");
}

// Operational vs Core, title first (authoritative), then the earliest acting
// role in content. Defaults to Operational — the bulk of GovOps duties sit with
// the Operational Executor GovOps.
export function classifyGovOpsRole(title, content) {
  if (CORE_ROLE_RE.test(title)) return "Core GovOps";
  if (OP_ROLE_RE.test(title)) return "Operational GovOps";
  const coreIdx = content.search(CORE_ROLE_RE);
  const opIdx = content.search(OP_ROLE_RE);
  if (coreIdx !== -1 && (opIdx === -1 || coreIdx < opIdx)) return "Core GovOps";
  return "Operational GovOps";
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Active-match false-positive shape: the subject changes after GovOps via an
// appositive-free ", the <Actor> <verb>" clause — "the findings of Core GovOps,
// the Core Facilitator resolves the dispute" (the Facilitator acts, not GovOps).
// A joint-subject LIST survives because its ", the <Actor>" segment is followed
// by another comma ("Core GovOps, the Core Facilitator, and the Aligned
// Delegates must review").
const NEW_SUBJECT_RE = /,\s+the\s+[A-Z][^,]*$/;

// First match of `re` whose matched text passes `valid` (used to skip the
// new-subject FP shape and keep scanning the rest of the doc).
function firstValidMatch(re, text, valid) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m;
  while ((m = g.exec(text))) {
    if (valid(m[0])) return m;
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return null;
}

// Match the full line containing index, bullet/whitespace-stripped, capped.
function quoteAt(text, index) {
  const start = text.lastIndexOf("\n", index) + 1;
  let end = text.indexOf("\n", index);
  if (end === -1) end = text.length;
  const line = text.slice(start, end).replace(/^[-*\s]+/, "").trim();
  return line.length > 240 ? `${line.slice(0, 239)}…` : line;
}

/**
 * Find a GovOps duty in one doc. `orgs` is [{ name, role_declared }] for the
 * GovOps org entities (resolved from {operational,core}_govops_for edges), so
 * duties attributed by org name ("Atlas Axis drafts …") are found even when the
 * word GovOps never appears. Returns { role_declared, match, quote } or null;
 * org matches additionally carry `orgName` so the caller can resolve the exact
 * entity instead of falling back to the role chain.
 */
export function findGovOpsDuty(title, content, orgs = []) {
  const text = normalizeGovOpsSpelling(content ?? "");
  if (TITLE_RE.test(normalizeGovOpsSpelling(title ?? ""))) {
    return { role_declared: classifyGovOpsRole(title, text), match: "title", quote: null };
  }
  const rolePatterns = [
    ["active", ROLE_ACTION_RE],
    ["passive", PASSIVE_ROLE_ACTION_RE],
    ...PHRASE_RES.map((re) => ["phrase", re]),
  ];
  for (const [match, re] of rolePatterns) {
    const m = firstValidMatch(re, text, (s) => match !== "active" || !NEW_SUBJECT_RE.test(s));
    if (m) {
      return { role_declared: classifyGovOpsRole(title, text), match, quote: quoteAt(text, m.index) };
    }
  }
  for (const { name, role_declared } of orgs) {
    const subj = String.raw`(?<!consultation\s+with\s+(?:the\s+)?)\b${escapeRe(name)}\b`;
    const orgActive = new RegExp(`${subj}[^.\\n]*?\\b(?:${MODAL}|${ACTIVE_VERBS})\\b`, "i");
    const orgPassive = new RegExp(
      `\\b(?:${PASSIVE_VERBS})\\b[^.\\n]*?\\bby\\s+(?:the\\s+)?${escapeRe(name)}\\b`,
      "i",
    );
    for (const [kind, re] of [
      ["active", orgActive],
      ["passive", orgPassive],
    ]) {
      const m = firstValidMatch(re, text, (s) => kind !== "active" || !NEW_SUBJECT_RE.test(s));
      if (m) return { role_declared, match: "org", quote: quoteAt(text, m.index), orgName: name };
    }
  }
  return null;
}
