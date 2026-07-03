// MEASURE the ordered-containment third corroborator (prototype A, plan §10.4) before
// wiring it into auto-curation. For every curation case it asks: does ordered word
// containment (an INDEPENDENT, order-sensitive, typo-tolerant similarity) independently
// pick the SAME predecessor the reverse matcher did (autoKey), with a clear margin?
//
//   bun scripts/aux/measure-containment-corroboration.mjs
//
// It then cross-validates against the decisions we ALREADY trust (public/history-auto-
// decisions.json): containment should AGREE with the forward∩reverse locks and the
// LLM-confirmed picks (precision proxy) and rarely CONTRADICT them; the residual cases it
// agrees on are the net-new safe yield. Offline, reads only the queue + decisions; writes
// nothing (a measurement, not a build step).

import fs from "node:fs";
import path from "node:path";
import { bestByContainment } from "./ordered-containment.mjs";

const ROOT = process.cwd();
const CURATION = path.join(ROOT, "public/history-curation.json");
const DECISIONS = path.join(ROOT, "public/history-auto-decisions.json");
if (!fs.existsSync(CURATION)) { console.error("run `pnpm htmlhist:curate` first (no history-curation.json)"); process.exit(1); }

const data = JSON.parse(fs.readFileSync(CURATION, "utf8"));
const decisionBy = new Map(); // caseKey -> { auto, chosenKey }
if (fs.existsSync(DECISIONS)) {
  for (const d of JSON.parse(fs.readFileSync(DECISIONS, "utf8")).decisions || []) decisionBy.set(d.caseKey, d);
}
const content = (key) => data.nodes[key]?.content ?? "";

// classify one case at a (threshold, margin) bar: does containment confidently pick a
// candidate, and is it autoKey?  AGREE / CONTRADICT (confident but a DIFFERENT older) /
// ABSTAIN (no confident pick). Cases the matcher abstained on (autoKey null) can't be
// corroborated — there's no reverse pick to agree with — so they're tracked separately.
function classify(kase, T, M) {
  if (!kase.autoKey) return "no-autopick";
  const cands = kase.candidates.map((c) => ({ key: c.key, content: content(c.key) })).filter((c) => c.content);
  if (!cands.length) return "no-content";
  const { best, bestScore, margin } = bestByContainment(content(kase.subjectKey), cands);
  if (!best || bestScore < T || margin < M) return "abstain";
  return best.key === kase.autoKey ? "agree" : "contradict";
}

const trust = (kase) => decisionBy.get(kase.key)?.auto ?? null; // "forward-reverse" | "llm-90" | null(=residual)
const tallyByKind = (list) => list.reduce((m, c) => ((m[c.kind] = (m[c.kind] || 0) + 1), m), {});

for (const [T, M] of [[0.6, 0.1], [0.7, 0.15], [0.8, 0.2]]) {
  const buckets = { fwdAgree: 0, fwdContra: 0, llmAgree: 0, llmContra: 0, newAgree: [], newContra: [], abstainResidual: 0 };
  for (const kase of data.cases) {
    const cls = classify(kase, T, M);
    const t = trust(kase);
    if (t === "forward-reverse") { if (cls === "agree") buckets.fwdAgree++; else if (cls === "contradict") buckets.fwdContra++; }
    else if (t === "llm-90") { if (cls === "agree") buckets.llmAgree++; else if (cls === "contradict") buckets.llmContra++; }
    else { // residual — not resolved by forward or LLM
      if (cls === "agree") buckets.newAgree.push(kase);
      else if (cls === "contradict") buckets.newContra.push(kase);
      else buckets.abstainResidual++;
    }
  }
  const fwdTotal = [...decisionBy.values()].filter((d) => d.auto === "forward-reverse").length;
  const llmTotal = [...decisionBy.values()].filter((d) => d.auto === "llm-90").length;
  console.error(`\n================  threshold ≥ ${T},  margin ≥ ${M}  ================`);
  console.error(`PRECISION PROXY (does containment match decisions we already trust?)`);
  console.error(`  forward∩reverse locks (${fwdTotal}):  containment agrees ${buckets.fwdAgree}  ·  CONTRADICTS ${buckets.fwdContra}`);
  console.error(`  LLM-confirmed picks  (${llmTotal}):  containment agrees ${buckets.llmAgree}  ·  CONTRADICTS ${buckets.llmContra}`);
  console.error(`NET-NEW YIELD (residual cases containment would newly lock):`);
  console.error(`  new safe locks: ${buckets.newAgree.length}  ${JSON.stringify(tallyByKind(buckets.newAgree))}`);
  console.error(`  containment disputes (best ≠ autoKey, confident): ${buckets.newContra.length}  ${JSON.stringify(tallyByKind(buckets.newContra))}`);
  console.error(`  still abstains (stays human): ${buckets.abstainResidual}`);
  if (T === 0.7) {
    const ex = buckets.newAgree.slice(0, 5).map((k) => `${k.kind} "${(data.nodes[k.subjectKey]?.title || "").slice(0, 40)}"`);
    console.error(`  sample net-new locks: ${JSON.stringify(ex, null, 0)}`);
    const cx = buckets.newContra.slice(0, 5).map((k) => `${k.kind} "${(data.nodes[k.subjectKey]?.title || "").slice(0, 40)}"`);
    if (cx.length) console.error(`  sample disputes (inspect): ${JSON.stringify(cx, null, 0)}`);
  }
}

const noAuto = data.cases.filter((c) => !c.autoKey).length;
console.error(`\n(${noAuto} cases have no matcher auto-pick — flagged-ambiguous — so containment can't corroborate them; they'd need containment as a PRIMARY proposer, a separate experiment.)`);
