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
// "found" is listed alongside the regular -ed/-en participles because it's an
// irregular past participle the suffix check alone misses: "more information
// can be found in the Executor Agents Section" (A.1.14.3.4.2) is a cross-
// reference pointer, not a duty, despite the preceding role mention.
// "required" is carved OUT of the -ed/-en exclusion specifically when followed
// by "to <verb>" — "Operational GovOps may be required to take escalatory
// steps" (A.2.2.10.1.1.3.3) is an obligation on GovOps ("must take"), not a
// true passive; "required" with no following "to" (or any other -ed/-en word)
// stays excluded as before.
// Also not when the modal introduces an explicit denial of power: "Atlas Axis
// will have no decision-making authority" grants nothing (A.1.15.1.2).
const MODAL = String.raw`(?:must|shall|will|may|can|should)(?!\s+(?:not\s+)?be\s+(?:required(?!\s+to\b)|(?!required\b)\w+(?:ed|en)|found)\b)(?!\s+(?:have|has)\s+no\b)`;

// Obligation/power verbs with the role as subject. "specified" is deliberately
// absent (cross-references read "… GovOps for Ozone are specified in A.6.1.2.2"
// — a doc pointer); its passive form lives in PASSIVE_VERBS where the "by"
// anchor guarantees an actor. The copula power forms allow one intervening
// adverb that isn't a negation: "is then empowered", never "is not empowered".
const ACTIVE_VERBS = String.raw`reviews?|validates?|calculates?|executes?|performs?|(?:is|are)\s+(?:(?!not\b)\w+\s+)?(?:responsible|empowered|permitted|granted|authorized)|coordinates?|provides?|carries?\s+out|carry\s+out|takes?\s+over|take\s+over|confirms?|submits?|maintains?|monitors?|approves?|prepares?|publishes?|ensures?|manages?|oversees?|conducts?|handles?|assesses?|updates?|receives?|verif(?:y|ies)|makes?|creates?|records?|determines?|decides?|designates?|communicates?|notif(?:y|ies)|informs?|gives?|posts?|resolves?|arranges?|compiles?|mints?|shares?|drafts?|incorporates?|seizes?|imposes?|proposes?|escalates?|distributes?|disburses?|evaluates?|interprets?|instructs?|agrees?|documents?|triggers?|initiates?|formalizes?`;

// Passive participles mirroring ACTIVE_VERBS plus by-anchored power forms
// (adjudicated/permitted/held/modified by GovOps). "controlled" is NOT here —
// bare "addresses controlled by GovOps" would pull in every multisig signer
// roster; the copula phrase below catches control of the multisig itself.
const PASSIVE_VERBS = String.raw`reviewed|validated|calculated|executed|performed|coordinated|provided|carried\s+out|taken\s+over|confirmed|submitted|maintained|monitored|approved|prepared|published|ensured|managed|overseen|conducted|handled|assessed|updated|received|verified|made|created|recorded|determined|decided|designated|communicated|notified|informed|given|posted|resolved|arranged|compiled|minted|shared|drafted|incorporated|seized|imposed|proposed|escalated|distributed|disbursed|evaluated|interpreted|instructed|agreed|documented|triggered|adjudicated|permitted|populated|modified|specified|initiated|held|granted|appointed|authorized|selected|chosen|processed|assigned`;

// Active-match false-positive shape: the subject changes after the role via an
// appositive-free ", the <Actor> <verb>" clause — "the findings of Core GovOps,
// the Core Facilitator resolves the dispute" (the Facilitator acts, not GovOps).
// A joint-subject LIST survives because its ", the <Actor>" segment is followed
// by another comma ("Core GovOps, the Core Facilitator, and the Aligned
// Delegates must review"). The same shape recurs without a comma via "then":
// "Core GovOps has posted the Final Calculation then the Core Facilitator must
// include payments…" (A.2.4.1.2.1.4) — the modal binds the new subject, not GovOps.
// A second alternative catches the same shift when the new subject is a bare
// proper noun with no "the" (how GovOps/Facilitator names are usually written):
// "…an Executor Agent, Core GovOps will no longer perform validation…"
// (A.2.2.1.1.13) — "will" binds Core GovOps, not the Executor Agent mentioned
// just before the comma. The terminal trigger is MODAL or ACTIVE_VERBS (not
// "any verb", as the "the <Actor>" alternative allows) — "…GovOps and
// Facilitator Actors, Executor Agents supervise other Agents and carry out…"
// (A.1.14.4.6) needs ACTIVE_VERBS too, since "carry out" is a regular verb,
// not a modal. Requiring one of these specific triggers (rather than any
// word) keeps this from over-triggering on ordinary prose after a comma.
const NEW_SUBJECT_RE = new RegExp(
  String.raw`(?:,\s+|\bthen\s+)the\s+[A-Z][^,]*$|(?:,\s+|\bthen\s+)[A-Z][\w\s]*?\b(?:${MODAL}|${ACTIVE_VERBS})\b[^,]*$`,
);

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
      // "The Operator Multisig is (jointly) controlled by Core GovOps" — an
      // optional indefinite-NP gap ("is a multisig controlled by…") and an
      // optional "and"/"from" bridge before the role ("controlled by the Core
      // Facilitator and Core GovOps", "controlled by two (2) signers from
      // Operational GovOps Soter Labs") let the role sit past an intervening
      // noun phrase or coordination without opening up to signer rosters
      // ("are three (3) addresses controlled by…" stays excluded — "three"
      // isn't "a"/"an").
      new RegExp(
        `\\b(?:is|are)\\s+(?:jointly\\s+)?(?:(?:a|an)\\s+[\\w-]+\\s+)?controlled\\s+by\\s+(?:[^.\\n]*?\\b(?:and|from)\\s+)?(?:the\\s+)?(?:(?:${role.qualifier})\\s+)?${role.subject}\\b${guard}`,
        "i",
      ),
      // "will be subject to the approval of Operational GovOps" (A.6.1.1.3.3.2)
      new RegExp(
        `\\bsubject\\s+to\\s+(?:the\\s+)?approval\\s+of\\s+(?:the\\s+)?(?:(?:${role.qualifier})\\s+)?${role.subject}\\b${guard}`,
        "i",
      ),
      // "require approval from the Protocol Security Workstream Lead and Core
      // GovOps" (A.2.2.10.1.1.1.6.2.1.3) — the "from"-anchored sibling of the
      // "subject to approval of" phrase above; the optional "X and" bridge
      // lets the role sit past another named approver in the same clause.
      new RegExp(
        `\\brequires?\\s+approval\\s+from\\s+(?:[^.\\n]*?\\band\\s+)?(?:the\\s+)?(?:(?:${role.qualifier})\\s+)?${role.subject}\\b${guard}`,
        "i",
      ),
      // "under the supervision of Core GovOps" (A.4.4.1.3.8.4.2)
      new RegExp(
        `\\bunder\\s+(?:the\\s+)?supervision\\s+of\\s+(?:the\\s+)?(?:(?:${role.qualifier})\\s+)?${role.subject}\\b${guard}`,
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

// First match of `re` whose matched text (and start index) passes `valid`
// (used to skip the new-subject / citation FP shapes and keep scanning).
function firstValidMatch(re, text, valid) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m;
  while ((m = g.exec(text))) {
    if (valid(m[0], m.index)) return m;
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return null;
}

// Cross-reference citations quote ANOTHER document's title inline —
// "[A.2.4.1.2.1.4.3 - Reimbursement Of Payments Made By Operational Executor
// Agents](07c5cfd2-…)" — a linked title phrased "…Made By <Role>" can satisfy
// a duty pattern even though it's a citation, not live prose about this doc.
const CITATION_RE = /\[(?:[A-Z][\w.]*|NR-\d+)\s*-\s*[^\]]+\]\([0-9a-f-]{36}\)/g;
function citationSpans(text) {
  const spans = [];
  const re = new RegExp(CITATION_RE.source, CITATION_RE.flags);
  let m;
  while ((m = re.exec(text))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}
function inCitation(spans, index) {
  return spans.some(([s, e]) => index >= s && index < e);
}

// Scope classifyRole's qualifier scan to the sentence containing the match,
// not the whole document — a bare/universal duty ("The Facilitator must act
// swiftly…") shouldn't inherit a "Core Facilitator" label from an unrelated
// escalation clause several sentences later in the same doc (A.1.6.6, A.1.6.8).
// A period only ends a sentence when followed by whitespace/end-of-string —
// otherwise a doc-number citation's internal dots ("[A.1.5 - …]") would be
// mistaken for sentence boundaries and truncate the scope prematurely.
function isSentenceEndDot(text, dotIndex) {
  const next = text[dotIndex + 1];
  return next === undefined || /\s/.test(next);
}
function sentenceAround(text, index) {
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === "\n" || (text[i] === "." && isSentenceEndDot(text, i))) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = index; i < text.length; i++) {
    if (text[i] === "\n" || (text[i] === "." && isSentenceEndDot(text, i))) {
      end = i;
      break;
    }
  }
  return text.slice(start, end);
}

// Match the full line containing index, bullet/whitespace-stripped, capped.
// Atlas paragraphs are un-wrapped — a single "line" can run well past 240
// chars — so a long line is windowed AROUND the match instead of truncated
// from its start, which previously hid the matched role past char 240.
function quoteAt(text, index) {
  const start = text.lastIndexOf("\n", index) + 1;
  let end = text.indexOf("\n", index);
  if (end === -1) end = text.length;
  const raw = text.slice(start, end);
  const MAX = 240;
  const HALF = 120;
  let winStart = 0;
  let winEnd = raw.length;
  if (raw.length > MAX) {
    const relIndex = index - start;
    winStart = Math.max(0, relIndex - HALF);
    winEnd = Math.min(raw.length, relIndex + HALF);
  }
  let quote = raw.slice(winStart, winEnd);
  if (winStart === 0) quote = quote.replace(/^[-*\s]+/, "");
  quote = quote.trim();
  if (winStart > 0) quote = `…${quote}`;
  if (winEnd < raw.length) quote = `${quote}…`;
  return quote;
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
    // A bare, non-qualified title ("Swift Action Is Required From
    // Facilitators…", A.1.6.6) has no hit index to scope classifyRole to —
    // use the first paragraph as a proxy for "what this section is actually
    // about", so a Core-only escalation clause several paragraphs later
    // doesn't leak backward and mislabel the section's real (universal) duty.
    const firstPara = text.split(/\n\n/)[0];
    return { role_declared: classifyRole(role, title, firstPara), match: "title", quote: null };
  }
  const citations = citationSpans(text);
  const rolePatterns = [
    ["active", m.active],
    ["passive", m.passive],
    ...m.phrases.map((re) => ["phrase", re]),
  ];
  for (const [match, re] of rolePatterns) {
    // The new-subject guard applies to "active" and "phrase" kinds — both can
    // land on a role mention that's really an intervening clause, with the
    // matched verb/phrase belonging to a DIFFERENT subject introduced after it
    // (A.1.14.5.4's "the Executor Agent, the Core Facilitator has discretion").
    const hit = firstValidMatch(
      re,
      text,
      (s, index) => !inCitation(citations, index) && (!["active", "phrase"].includes(match) || !NEW_SUBJECT_RE.test(s)),
    );
    if (hit) {
      const scope = sentenceAround(text, hit.index);
      return { role_declared: classifyRole(role, title, scope), match, quote: quoteAt(text, hit.index) };
    }
  }
  for (const { name, role_declared } of orgs) {
    const subj = String.raw`(?<!consultation\s+with\s+(?:the\s+)?)\b${escapeRe(name)}\b`;
    const orgActive = new RegExp(`${subj}[^.\\n]*?\\b(?:${MODAL}|${ACTIVE_VERBS})\\b`, "i");
    const orgPassive = new RegExp(
      `\\b(?:${PASSIVE_VERBS})\\b[^.\\n]*?\\bby\\s+(?:the\\s+)?${escapeRe(name)}\\b`,
      "i",
    );
    // Instance-detail colon fields grant a role with no verb at all:
    // "- Curator: Soter Labs, implemented via a Gnosis Safe multisig…"
    // (A.6.1.1.<n>.3.9.7.2.<m> — one per Delegated Risk Curation instance).
    const orgColon = new RegExp(`^[ \\t]*-?[ \\t]*[A-Z][\\w /]*:[ \\t]*${escapeRe(name)}\\b`, "im");
    for (const [kind, re] of [
      ["active", orgActive],
      ["passive", orgPassive],
      ["colon", orgColon],
    ]) {
      const hit = firstValidMatch(
        re,
        text,
        (s, index) => !inCitation(citations, index) && (kind !== "active" || !NEW_SUBJECT_RE.test(s)),
      );
      if (hit) return { role_declared, match: "org", quote: quoteAt(text, hit.index), orgName: name };
    }
  }
  return null;
}

// All matches of `re` whose matched text (and start index) pass `valid` —
// findRoleDuties needs every candidate, not just the first, to find a SECOND
// duty for the opposite qualifier elsewhere in the same doc.
function allValidMatches(re, text, valid) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const hits = [];
  let m;
  while ((m = g.exec(text))) {
    if (valid(m[0], m.index)) hits.push(m);
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return hits;
}

/**
 * Find every DISTINCT duty for one role in one doc — at most one per
 * declared qualifier (Core / Operational / bare), keeping the first
 * occurrence of each. Most docs have exactly one; a handful genuinely assign
 * the role's Core-side and Operational-side holders SEPARATE duties in the
 * same doc — a "Sky Governance path / Independent Governance path" branch
 * (A.1.10.2.3.2.2.3.3.2), an "if in the Sky Core Atlas … if in an Agent
 * Artifact …" branch (A.1.13.1.3.1), or just two consecutive sentences with
 * no branching language at all (A.3.2.2.7.2.1.2's "Core GovOps may require…
 * Operational GovOps will assist…"). findRoleDuty (singular) only ever
 * returns the first of these. Same element shape as findRoleDuty; returns []
 * instead of null when nothing is found.
 *
 * Content is scanned BEFORE the title, unlike findRoleDuty — a verb-grounded,
 * quoted content match is strictly more trustworthy than a title-based guess,
 * and title-match docs are exactly where a bare title ("Facilitator Updates
 * Atlas…") can sit over content that itself states both a Core and an
 * Operational duty (A.1.10.2.4.13.5). The title is only consulted as a
 * fallback when the content has nothing verb-anchored to offer at all
 * ("Facilitator Duties" over "The sections below describe them.").
 */
export function findRoleDuties(role, title, content, orgs = []) {
  const m = matchers(role);
  const text = role.normalize(content ?? "");
  const citations = citationSpans(text);
  const rolePatterns = [
    ["active", m.active],
    ["passive", m.passive],
    ...m.phrases.map((re) => ["phrase", re]),
  ];
  const byDeclared = new Map();
  for (const [match, re] of rolePatterns) {
    if (byDeclared.has(role.core.label) && byDeclared.has(role.op.label)) break;
    const hits = allValidMatches(
      re,
      text,
      (s, index) => !inCitation(citations, index) && (!["active", "phrase"].includes(match) || !NEW_SUBJECT_RE.test(s)),
    );
    for (const hit of hits) {
      const scope = sentenceAround(text, hit.index);
      const declared = classifyRole(role, title, scope);
      if (!byDeclared.has(declared)) {
        byDeclared.set(declared, { role_declared: declared, match, quote: quoteAt(text, hit.index) });
      }
    }
  }
  // A bare/universal duty already binds every holder (resolveDutyEntities fans it
  // to [...opIds, coreId]). If the same doc also yielded a Core/Op-specific
  // declaration, that specific edge re-binds a holder the universal one already
  // covers — double-counting the core org (bare+Core, A.1.6.6). Bare subsumes the
  // specific labels. Only applies where bareLabel is a distinct key (Facilitator/
  // Executor); GovOps's bareLabel === op.label so they already share a bucket and
  // the intended Core+Op combo is preserved.
  const bareDistinct = role.bareLabel !== role.op.label && role.bareLabel !== role.core.label;
  if (bareDistinct && byDeclared.has(role.bareLabel) && byDeclared.size > 1) {
    return [byDeclared.get(role.bareLabel)];
  }
  if (byDeclared.size) return [...byDeclared.values()];
  if (role.titleScan && m.title.test(role.normalize(title ?? ""))) {
    const firstPara = text.split(/\n\n/)[0];
    return [{ role_declared: classifyRole(role, title, firstPara), match: "title", quote: null }];
  }
  for (const { name, role_declared } of orgs) {
    const subj = String.raw`(?<!consultation\s+with\s+(?:the\s+)?)\b${escapeRe(name)}\b`;
    const orgActive = new RegExp(`${subj}[^.\\n]*?\\b(?:${MODAL}|${ACTIVE_VERBS})\\b`, "i");
    const orgPassive = new RegExp(
      `\\b(?:${PASSIVE_VERBS})\\b[^.\\n]*?\\bby\\s+(?:the\\s+)?${escapeRe(name)}\\b`,
      "i",
    );
    const orgColon = new RegExp(`^[ \\t]*-?[ \\t]*[A-Z][\\w /]*:[ \\t]*${escapeRe(name)}\\b`, "im");
    for (const [kind, re] of [
      ["active", orgActive],
      ["passive", orgPassive],
      ["colon", orgColon],
    ]) {
      const hit = firstValidMatch(
        re,
        text,
        (s, index) => !inCitation(citations, index) && (kind !== "active" || !NEW_SUBJECT_RE.test(s)),
      );
      if (hit) return [{ role_declared, match: "org", quote: quoteAt(text, hit.index), orgName: name }];
    }
  }
  return [];
}

// ── back-compat GovOps API (tests + existing call sites) ───────────────────
const GOVOPS = DUTY_ROLES.find((r) => r.key === "govops");

export function findGovOpsDuty(title, content, orgs = []) {
  return findRoleDuty(GOVOPS, title, content, orgs);
}

export function classifyGovOpsRole(title, content) {
  return classifyRole(GOVOPS, title, GOVOPS.normalize(content ?? ""));
}
