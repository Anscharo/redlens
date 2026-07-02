/**
 * Acting-role duty discovery for build-graph section 2s-ter (duty_for edges).
 *
 * Generalized over the actor roles the atlas tasks with work — GovOps,
 * Facilitator, Executor Agent — with shared vocabulary, guards, and quote
 * provenance. Match kinds per (doc, role), in priority order:
 *   title   — the doc title names the role (duty containers like "Operational
 *             GovOps Review"); no quote, the frontend derives a snippet.
 *   active  — the role is the grammatical subject of an obligation/power verb.
 *   passive — the role is the agent of a passive ("approved by Core GovOps").
 *   phrase  — power idioms with no listed verb ("at the discretion of",
 *             "has the ability to", "is controlled by").
 *   org     — same active/passive scan keyed on an org/entity NAME holding the
 *             role ("Atlas Axis drafts …", "Amatsu prepares …"); names are
 *             resolved from the graph, never hardcoded.
 */

// Modals count as obligation markers, but not when they introduce a passive in
// which the role is the patient, not the actor: "items … must be added",
// "Atlas Axis will be embedded". "will be able to" is not a passive — keep it.
const MODAL = String.raw`(?:must|shall|will|may|can|should)(?!\s+(?:not\s+)?be\s+\w+(?:ed|en)\b)`;

// Obligation/power verbs with the role as subject. "specified" is deliberately
// absent (cross-references read "… GovOps for Ozone are specified in A.6.1.2.2"
// — a doc pointer); its passive form lives in PASSIVE_VERBS where the "by"
// anchor guarantees an actor. The copula power forms allow one intervening
// adverb that isn't a negation: "is then empowered", never "is not empowered".
const ACTIVE_VERBS = String.raw`reviews?|validates?|calculates?|executes?|performs?|(?:is|are)\s+(?:(?!not\b)\w+\s+)?(?:responsible|empowered|permitted|granted|authorized)|coordinates?|provides?|carries?\s+out|carry\s+out|takes?\s+over|take\s+over|confirms?|submits?|maintains?|monitors?|approves?|prepares?|publishes?|ensures?|manages?|oversees?|conducts?|handles?|assesses?|updates?|receives?|verif(?:y|ies)|makes?|creates?|records?|determines?|decides?|designates?|communicates?|notif(?:y|ies)|informs?|gives?|posts?|resolves?|arranges?|compiles?|mints?|shares?|drafts?|incorporates?|seizes?|imposes?|proposes?|escalates?|distributes?|disburses?|evaluates?|interprets?|instructs?|agrees?|documents?|triggers?`;

// Passive participles mirroring ACTIVE_VERBS plus by-anchored power forms
// (adjudicated/permitted/held/modified by GovOps). "controlled" is NOT here —
// bare "addresses controlled by GovOps" would pull in every multisig signer
// roster; the copula phrase below catches control of the multisig itself.
const PASSIVE_VERBS = String.raw`reviewed|validated|calculated|executed|performed|coordinated|provided|carried\s+out|taken\s+over|confirmed|submitted|maintained|monitored|approved|prepared|published|ensured|managed|overseen|conducted|handled|assessed|updated|received|verified|made|created|recorded|determined|decided|designated|communicated|notified|informed|given|posted|resolved|arranged|compiled|minted|shared|drafted|incorporated|seized|imposed|proposed|escalated|distributed|disbursed|evaluated|interpreted|instructed|agreed|documented|triggered|adjudicated|permitted|populated|modified|specified|initiated|held|granted|appointed|authorized|selected|chosen`;

// Active-match false-positive shape: the subject changes after the role via an
// appositive-free ", the <Actor> <verb>" clause — "the findings of Core GovOps,
// the Core Facilitator resolves the dispute" (the Facilitator acts, not GovOps).
// A joint-subject LIST survives because its ", the <Actor>" segment is followed
// by another comma ("Core GovOps, the Core Facilitator, and the Aligned
// Delegates must review").
const NEW_SUBJECT_RE = /,\s+the\s+[A-Z][^,]*$/;

/**
 * Role configs. `subject` and `qualifier` are regex sources; `compounds` are
 * noun-compound guards ("GovOps meeting" is a venue, not an actor). `bareLabel`
 * is the role_declared for a subject with no qualifier anywhere: GovOps keeps
 * the legacy "Operational GovOps" default (the bulk of bare-GovOps duties sit
 * with the operational side); Facilitator/Executor keep the bare label because
 * unqualified duties there are UNIVERSAL (A.1.6 binds every Facilitator) and
 * labeling them operational would be invented precision. `titleScan: false`
 * for Executor Agent — its title-hits are structural cross-reference docs
 * ("Operational Executor Agent" stubs under each agent artifact), not duties.
 */
export const DUTY_ROLES = [
  {
    key: "govops",
    subject: String.raw`GovOps`,
    qualifier: String.raw`Operational|Core`,
    compounds: ["meeting", "channel"],
    core: { re: /\bCore\s*GovOps\b/i, label: "Core GovOps" },
    op: { re: /\bOperational\s*GovOps\b/i, label: "Operational GovOps" },
    bareLabel: "Operational GovOps",
    titleScan: true,
    // Looser than the subject regex: titles also spell it "Gov Ops"/"gov-ops".
    titleRe: /gov[\s-]*ops(?!\s+(?:meeting|channel)s?\b)/i,
    // The atlas occasionally spells the role without a space ("CoreGovOps reviews").
    normalize: (t) => t.replace(/\b(Operational|Core)(GovOps)\b/g, "$1 $2"),
  },
  {
    key: "facilitator",
    subject: String.raw`Facilitators?`,
    qualifier: String.raw`Operational|Core`,
    compounds: [],
    core: { re: /\bCore\s+Facilitators?\b/i, label: "Core Facilitator" },
    op: { re: /\bOperational\s+Facilitators?\b/i, label: "Operational Facilitator" },
    bareLabel: "Facilitator",
    titleScan: true,
    normalize: (t) => t,
  },
  {
    key: "executor",
    subject: String.raw`Executor\s+Agents?`,
    qualifier: String.raw`Operational|Core(?:\s+Council)?`,
    compounds: [],
    core: { re: /\bCore(?:\s+Council)?\s+Executor\s+Agents?\b/i, label: "Core Executor Agent" },
    op: { re: /\bOperational\s+Executor\s+Agents?\b/i, label: "Operational Executor Agent" },
    bareLabel: "Executor Agent",
    titleScan: false,
    normalize: (t) => t,
  },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Compiled matchers per role, built once.
const matchersByKey = new Map();
function matchers(role) {
  let m = matchersByKey.get(role.key);
  if (m) return m;
  const guard = role.compounds.length ? `(?!\\s+(?:${role.compounds.join("|")})s?\\b)` : "";
  // The role as an actor. Guards: not the consulted party ("in consultation
  // with Core GovOps" — the subject is whoever consults); not a noun compound.
  const subj = `(?<!consultation\\s+with\\s+(?:the\\s+)?(?:(?:${role.qualifier})\\s+)?)(?:(?:${role.qualifier})\\s+)?${role.subject}\\b${guard}`;
  m = {
    title: role.titleRe ?? new RegExp(`${role.subject}${guard}`, "i"),
    active: new RegExp(`${subj}[^.\\n]*?\\b(?:${MODAL}|${ACTIVE_VERBS})\\b`, "i"),
    passive: new RegExp(
      `\\b(?:${PASSIVE_VERBS})\\b[^.\\n]*?\\bby\\s+(?:the\\s+)?(?:(?:${role.qualifier})\\s+)?${role.subject}\\b${guard}`,
      "i",
    ),
    phrases: [
      // "may change at the discretion of Core GovOps"
      new RegExp(
        `\\b(?:at|in)\\s+(?:the|their|its)\\s+(?:sole\\s+)?discretion\\s+of\\s+(?:the\\s+)?(?:(?:${role.qualifier})\\s+)?${role.subject}\\b${guard}`,
        "i",
      ),
      // "Core GovOps … has the ability to modify / have full discretion …"
      new RegExp(`${subj}[^.\\n]*?\\b(?:has|have)\\b[^.\\n]*?\\b(?:discretion|authority|the\\s+ability)\\b`, "i"),
      // "The Operator Multisig is (jointly) controlled by Core GovOps"
      new RegExp(
        `\\b(?:is|are)\\s+(?:jointly\\s+)?controlled\\s+by\\s+(?:the\\s+)?(?:(?:${role.qualifier})\\s+)?${role.subject}\\b${guard}`,
        "i",
      ),
    ],
  };
  matchersByKey.set(role.key, m);
  return m;
}

// Operational vs Core, title first (authoritative), then the earliest acting
// qualifier in content, falling back to the role's bare label.
export function classifyRole(role, title, content) {
  if (role.core.re.test(title)) return role.core.label;
  if (role.op.re.test(title)) return role.op.label;
  const coreIdx = content.search(role.core.re);
  const opIdx = content.search(role.op.re);
  if (coreIdx !== -1 && (opIdx === -1 || coreIdx < opIdx)) return role.core.label;
  if (opIdx !== -1) return role.op.label;
  return role.bareLabel;
}

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
 * Find a duty for one role in one doc. `orgs` is [{ name, role_declared }] for
 * entities holding the role (resolved from graph edges), so duties attributed
 * by name ("Atlas Axis drafts …", "Amatsu prepares …") are found even when the
 * role word never appears. Returns { role_declared, match, quote } or null;
 * org matches additionally carry `orgName` so the caller can resolve the exact
 * entity instead of falling back to the role chain.
 */
export function findRoleDuty(role, title, content, orgs = []) {
  const m = matchers(role);
  const text = role.normalize(content ?? "");
  if (role.titleScan && m.title.test(role.normalize(title ?? ""))) {
    return { role_declared: classifyRole(role, title, text), match: "title", quote: null };
  }
  const rolePatterns = [
    ["active", m.active],
    ["passive", m.passive],
    ...m.phrases.map((re) => ["phrase", re]),
  ];
  for (const [match, re] of rolePatterns) {
    const hit = firstValidMatch(re, text, (s) => match !== "active" || !NEW_SUBJECT_RE.test(s));
    if (hit) {
      return { role_declared: classifyRole(role, title, text), match, quote: quoteAt(text, hit.index) };
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
      const hit = firstValidMatch(re, text, (s) => kind !== "active" || !NEW_SUBJECT_RE.test(s));
      if (hit) return { role_declared, match: "org", quote: quoteAt(text, hit.index), orgName: name };
    }
  }
  return null;
}

// ── back-compat GovOps API (tests + existing call sites) ───────────────────
const GOVOPS = DUTY_ROLES.find((r) => r.key === "govops");

export function findGovOpsDuty(title, content, orgs = []) {
  return findRoleDuty(GOVOPS, title, content, orgs);
}

export function classifyGovOpsRole(title, content) {
  return classifyRole(GOVOPS, title, GOVOPS.normalize(content ?? ""));
}
