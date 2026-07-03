// Pure decision-audit logic for the HTML-era curation (plan §10.4, pass 1 of 2). Kept out of
// the aux entry-point so it is unit-testable without git/LLM: resolve each recorded decision to
// its queue case + evidence, classify agreement vs an independent auditor pick, and summarize the
// conflicts by method + kind. The aux script (audit-html-decisions.mjs) supplies the auditor's
// picks (a cheap second model) and does the IO; everything judgemental lives here.
import { mechanismToMethod } from "./auto-curate.mjs";

// How the ORIGINAL decision was traced. The committed human file stamps `method`
// (deterministic | ai | human); the raw auto-baseline file carries `auto` (a mechanism) instead,
// so fall back to mapping it. Defaults to deterministic (the unbadged baseline) when neither is
// present — so the audit works pointed at either decisions file.
export function decisionMethod(d) {
  return d.method ?? (d.auto ? mechanismToMethod(d.auto) : "deterministic");
}

// Pair each recorded decision with its queue case (subject + candidates + node bodies). Decisions
// whose caseKey isn't in the queue are dropped (reported separately) — they carry no evidence to
// re-judge against.
export function buildAuditItems(data, decisionsFile) {
  const byCase = new Map((data.cases || []).map((c) => [c.key, c]));
  const items = [], unmapped = [];
  for (const decision of decisionsFile.decisions || []) {
    const kase = byCase.get(decision.caseKey);
    if (kase) items.push({ decision, kase, method: decisionMethod(decision) });
    else unmapped.push(decision.caseKey);
  }
  return { items, unmapped };
}

const clip = (t, max = 600) => (t || "").slice(0, max);

// One self-contained disagreement record: enough subject/candidate evidence for a pass-2 reviewer
// (Claude or a human) to adjudicate WITHOUT re-opening the 6 MB queue. `nodeOf(key)` resolves a
// content-address to its {title,type,doc_no,content}. Flags which candidate each side picked.
export function buildDisagreement(item, auditor, nodeOf) {
  const { decision, kase, method } = item;
  const subj = nodeOf(kase.subjectKey);
  const titleOf = (k) => (k === "none" ? "(none — created here)" : nodeOf(k).title);
  return {
    caseKey: decision.caseKey, kind: decision.kind, method,
    newerSha: decision.newerSha, olderSha: decision.olderSha,
    subject: { title: subj.title, doc_no: subj.doc_no, type: subj.type, content: clip(subj.content) },
    decision: { chosenKey: decision.chosenKey, title: titleOf(decision.chosenKey) },
    auditor: { model: auditor.model, chosenKey: auditor.chosenKey, title: titleOf(auditor.chosenKey), why: auditor.why },
    candidates: kase.candidates.map((cd) => {
      const n = nodeOf(cd.key);
      return {
        key: cd.key, score: cd.score, title: n.title, type: n.type, content: clip(n.content),
        isDecision: cd.key === decision.chosenKey, isAuditor: cd.key === auditor.chosenKey,
      };
    }),
  };
}

// Fold the auditor's results (aligned with `items` by index) into a summary. Each result is
// {chosenKey,why,model} | {error} | null (skipped, e.g. over a --limit). A disagreement = the
// auditor named a DIFFERENT predecessor than the recorded decision. Counts break down by method
// (deterministic | ai | human) and kind, so a reviewer sees WHERE the second model objects.
export function summarizeAudit(items, results, nodeOf) {
  const byMethod = {}, byKind = {}, disagreements = [];
  let audited = 0, agree = 0, skipped = 0;
  const errors = [];
  items.forEach((item, i) => {
    const r = results[i];
    if (!r) { skipped++; return; }
    if (r.error) { errors.push({ caseKey: item.decision.caseKey, error: r.error }); return; }
    const m = (byMethod[item.method] ||= { audited: 0, disagree: 0 });
    const k = (byKind[item.decision.kind] ||= { audited: 0, disagree: 0 });
    audited++; m.audited++; k.audited++;
    if (r.chosenKey === item.decision.chosenKey) agree++;
    else { m.disagree++; k.disagree++; disagreements.push(buildDisagreement(item, r, nodeOf)); }
  });
  // Order disagreements highest-signal first: human-decided (a weak model contradicting a person
  // is the most worth a look), then ai, then deterministic; within a method, by kind. So the
  // pass-2 reviewer reads the most consequential conflicts at the top.
  const rank = { human: 0, ai: 1, deterministic: 2 };
  disagreements.sort((a, b) => (rank[a.method] - rank[b.method]) || a.kind.localeCompare(b.kind));
  return { audited, agree, disagree: disagreements.length, skipped, errors, byMethod, byKind, disagreements };
}
