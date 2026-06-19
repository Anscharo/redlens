// Pattern 23: Pending operational transitions (Phase 2.8)
//
// The atlas records a handful of operational-control handoffs where a system or
// process is being moved from one party to another — typically from Sky Core to
// a Prime Agent as the agent matures:
//
//   "Control of the Lite PSM is being transitioned to Grove."
//   "The modification of SparkLend parameters is temporarily controlled by Sky
//    Core, but will be transitioned to Spark in the future."
//   "…control will transition to Spark Governance." (estimated September 17, 2025)
//
// These become `pending_transition` doc(subject) → entity(future holder) edges
// so a facilitator / the chatbot can answer "what control is handing off, to
// whom, and is it overdue?". Edge meta carries the current holder and the raw
// estimated-date string (NOT a computed `overdue` flag — that would make the
// build non-deterministic; consumers compare est_date to today themselves, the
// way the Stale Dates report does).
//
// This is a deliberately narrow, well-gated pattern: a "transition/temporary"
// keyword sweep over the atlas is ~80% false positives (the macro "transition
// to Endgame", tuning-parameter "transitions", breach-severity changes). The
// gate here is strict — a control/operational verb AND a "transition … to
// {resolvable party}" clause in the same doc — and unresolved operational-
// looking handoffs warn rather than silently dropping.

import { slugify } from "./graph-patterns.mjs";

const CONTROL_RE =
  /\b(control|controlled|modification|onboarding|offboarding|process|operation|implement|managed?|responsib)\b/i;
// "transitioned/transitioning/transition … (over) to {Title-Case party}"
const TRANSITION_RE =
  /transition(?:ed|ing)?\s+(?:over\s+)?to\s+([A-Z][\w]*(?:\s+[A-Z][\w]*)*)/g;
// No `i` flag: the verbs are lower-case in the atlas, and `[A-Z]` must stay
// upper-case so the holder capture stops at the first lower-case word
// ("… by Sky Core Governance until Sky determines …" → "Sky Core Governance").
const CURRENT_HOLDER_RE =
  /(?:temporarily\s+|continues?\s+to\s+be\s+|currently\s+)?(?:controlled|implemented|managed)\s+by\s+([A-Z][\w]*(?:\s+[A-Z][\w]*)*)/;
const EST_DATE_RE =
  /estimated\s+(?:for|to\s+(?:be|occur)[^,.]*?)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i;

// Title-case phrases that look like a handoff target but are not parties — keep
// them out of the never-silent warning stream.
const SKIP_HOLDERS = new Set(["endgame", "endgame state", "the endgame"]);

export function extractTransitions(allDocs, docById, docByDocNo, entityMap, edges) {
  let count = 0;
  let warnings = 0;

  const warn = (msg) => {
    warnings++;
    console.warn(`  [transition] ${msg}`);
  };

  // Resolve a holder name to an agent / bootstrap entity. Agent slugs are the
  // lowercased name (grove, spark, …); "X Governance" falls back to X.
  const resolveHolder = (raw) => {
    const s = raw.trim().replace(/\s+/g, " ");
    let ent = entityMap.get(slugify(s));
    if (ent) return ent;
    const m = s.match(/^(.+?)\s+Governance$/i);
    if (m) {
      ent = entityMap.get(slugify(m[1]));
      if (ent) return ent;
    }
    if (/^sky\s+governance$/i.test(s)) return entityMap.get("sky-governance");
    return null;
  };

  for (const d of allDocs) {
    const content = d.content ?? "";
    if (!CONTROL_RE.test(content)) continue;

    // Find the first transition clause whose target resolves to a party. (A doc
    // may open with a "The documents herein …" directory sentence and still
    // carry a real transition claim — e.g. SparkLend — so we gate on the
    // resolvable clause, not on the intro shape. Pure directory docs like
    // "… the transition to ownership by Grove" don't resolve a holder.)
    let future = null;
    let unresolved = null;
    for (const m of content.matchAll(TRANSITION_RE)) {
      const holderRaw = m[1];
      const ent = resolveHolder(holderRaw);
      if (ent) {
        future = ent;
        break;
      }
      if (!SKIP_HOLDERS.has(holderRaw.trim().toLowerCase())) unresolved = holderRaw.trim();
    }
    if (!future) {
      // Only flag operational-looking handoffs we couldn't resolve — quietly
      // ignore Endgame-style prose and clauses with no party target.
      if (unresolved) warn(`${d.doc_no} «${d.title}» — transition target "${unresolved}" did not resolve`);
      continue;
    }

    const meta = {};
    const ch = content.match(CURRENT_HOLDER_RE);
    if (ch) {
      const holder = resolveHolder(ch[1]);
      meta.current_holder = holder ? holder.name : ch[1].trim();
    }
    const ed = content.match(EST_DATE_RE);
    if (ed) meta.est_date = ed[1].replace(/\s+/g, " ").trim();

    edges.push({
      fromId: d.id,
      fromType: "doc",
      toId: future.id,
      toType: "entity",
      edgeType: "pending_transition",
      sourceDocNos: [d.doc_no],
      meta: Object.keys(meta).length ? JSON.stringify(meta) : null,
    });
    count++;
  }

  return { count, warnings };
}
