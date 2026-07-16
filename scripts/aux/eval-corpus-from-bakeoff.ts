// Promote bakeoff runs into the verifier/advisor corpus (scripts/aux/eval-corpora/evidence/,
// same SavedRun shape eval:golden --save-evidence writes).
//
// NO DETERMINISTIC FILTER — deliberately. An earlier version required
// `fabTotal === 0`, which was circular: it excluded exactly the answers the
// checker flags, so the corpus could never expose a checker FALSE POSITIVE,
// and it silently dropped the models that attribute most rigorously (glm was
// cut for citing with both uuid and doc_no — a checker bug, not a defect).
// We now select on INDEPENDENT quality signals only (judge + a resolvable
// citation) and RECORD the checker's flags on each entry, so baseline
// false-positive rate becomes measurable instead of assumed away.
//
// Bar: no error · judged · support ≥ 0.8 · honesty ≥ 0.7 · ≥1 citation ·
//      toolTexts saved · no INVALID citation uuid (unambiguous: it resolves
//      or it doesn't — the one check with no false-positive class).
// One entry per query id (best score wins across reports/models). Golden-run
// files are left untouched — bakeoff entries are namespaced bakeoff-<qid>.
//
//   bun scripts/aux/eval-corpus-from-bakeoff.ts
import fs from "node:fs";
import path from "node:path";
import { config } from "../../src/server/config.ts";
import { loadIndexes } from "../../src/server/indexes.ts";
import { runDeterministicChecks } from "../../src/server/verify-checks.ts";
import type { EvidenceEntry } from "../../src/server/verifier.ts";
import { BAKEOFF_QUERIES } from "./eval-bakeoff-queries.ts";
import { RULING_QUERIES } from "./eval-bakeoff-rulings.ts";
import { EXTENDED_QUERIES } from "./eval-bakeoff-extended.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const EVIDENCE_DIR = process.env.EVAL_EVIDENCE_DIR ?? path.join(ROOT, "scripts", "aux", "eval-corpora", "evidence");
const REPORTS = ["eval-bakeoff.json", "eval-bakeoff-rulings.json", "eval-bakeoff-extended.json", "eval-bakeoff-all.json"]
  .map((f) => path.join(ROOT, ".cache", f)).filter((p) => fs.existsSync(p));

const ix = loadIndexes();
const questionOf = new Map([...BAKEOFF_QUERIES, ...RULING_QUERIES, ...EXTENDED_QUERIES].map((q) => [q.id, q.query]));

interface BakeoffRun {
  model: string; id: string; score: number | null;
  judge: { support: number; honesty: number } | null;
  fabrications: Record<string, number>;
  citations: number; answer: string; error: string | null; toolTexts?: string[];
}

const best = new Map<string, BakeoffRun>();
for (const report of REPORTS) {
  const { results } = JSON.parse(fs.readFileSync(report, "utf8")) as { results: BakeoffRun[] };
  for (const r of results ?? []) {
    // Independent signals only: judge quality + a citation that actually
    // resolves. Quote/doc_no/number/address flags are RECORDED below, never
    // used to select — that circularity is the bug this file used to have.
    const eligible =
      !r.error && r.judge && r.judge.support >= 0.8 && r.judge.honesty >= 0.7 &&
      r.citations >= 1 && (r.toolTexts?.length ?? 0) > 0 && questionOf.has(r.id) &&
      (r.fabrications?.rawInvalidCitations ?? 0) === 0 && (r.fabrications?.stripped ?? 0) === 0;
    if (!eligible) continue;
    const prev = best.get(r.id);
    if (!prev || (r.score ?? 0) > (prev.score ?? 0)) best.set(r.id, r);
  }
}

// Evidence entries from saved tool texts, newest-first char budget like the
// runtime's evidenceFromTranscript (tool/args weren't saved — content is what
// the verifier audits against).
function evidenceOf(toolTexts: string[]): EvidenceEntry[] {
  let budget = config.chatVerifierEvidenceMaxChars;
  const kept: string[] = [];
  for (const t of [...toolTexts].reverse()) {
    if (budget <= 0) break;
    kept.unshift(t.slice(0, budget));
    budget -= t.length;
  }
  return kept.map((content, i) => ({ label: `[E${i + 1}]`, tool: "atlas_tool", args: "(from bakeoff transcript)", content }));
}

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
let flaggedCount = 0;
for (const [qid, r] of best) {
  // Record what the checker thinks WITHOUT letting it select. An entry whose
  // flags are checker false positives is the most valuable thing in the corpus:
  // it is exactly what a baseline FPR measurement needs to see.
  const toolTexts = r.toolTexts!;
  const c = runDeterministicChecks(r.answer, toolTexts, ix);
  const flags = {
    invalidDocNos: c.invalidDocNos,
    docNoMismatches: c.docNoMismatches,
    ungroundedQuotes: c.ungroundedQuotes,
    ungroundedAddresses: c.ungroundedAddresses,
    untracedNumbers: c.untracedNumbers,
  };
  const flagged = c.invalidDocNos.length + c.docNoMismatches.length + c.ungroundedQuotes.length + c.ungroundedAddresses.length;
  if (flagged) flaggedCount++;
  const run = {
    id: `bakeoff-${qid}`,
    question: questionOf.get(qid)!,
    answer: r.answer,
    evidence: evidenceOf(toolTexts),
    sourceModel: r.model,
    checkerFlags: flags, // recorded, NOT used to select — see header
    audit: null as null | { verdict: "clean" | "defect"; notes: string },
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, `bakeoff-${qid}.json`), JSON.stringify(run, null, 2));
  console.log(`bakeoff-${qid.padEnd(28)} ← ${r.model.split("/")[1].padEnd(22)} score=${r.score}${flagged ? `  [checker flags: ${flagged}]` : ""}`);
}
const total = fs.readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".json")).length;
console.log(`\npromoted ${best.size} bakeoff runs from ${REPORTS.length} report(s); corpus now ${total} runs`);
console.log(`${flaggedCount}/${best.size} promoted entries carry checker flags — previously these were EXCLUDED, hiding checker false positives.`);
