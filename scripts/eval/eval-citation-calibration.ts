// Calibration pass for the A1 citation check — "when a user sees this mark,
// how often is the citation actually right?"
//
//   pnpm eval:citation:calibration
//
// The bakeoff (eval-citation.ts) asks which QUESTION design is best. This asks
// a different thing: of the two numbers Jev hands back with every Choice, which
// one — if either — predicts whether the mark is correct, and what does a given
// value actually mean in practice.
//
//   confidence            — distribution CONCENTRATION. How sharply the winner
//                           beat the rest. Two near-synonym options (`supports`
//                           and `supports_in_part` both mean "backs the line")
//                           split mass and depress it without the mark being
//                           any less trustworthy.
//   probabilities[verdict] — P(this label), the quantity a reader cares about,
//                           but still the model reporting on itself.
//
// LABELS. Negatives are certain: every one is a real sentence repointed at a
// document that is not its source, so a correct check FLAGS it. Positives are
// NOT gold — "positive" only means a model wrote the citation (see
// eval-citation-cases.ts). Treating them as correct is an assumption, and it
// biases the false-flag side only. Read the two halves separately.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { judgeCitation, buildCiteRequest, CITE_QUESTION, type CiteVerdict } from "../../src/server/chat/verify/cite-support.ts";
import { buildCases, type CaseKind, type CiteCase } from "./eval-citation-cases.ts";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { config } from "../../src/server/config.ts";

const KINDS: CaseKind[] = ["positive", "random", "parent", "sibling", "same_title", "cited_elsewhere"];
const MODEL = process.env.JEV_MODEL ?? config.chatJevModel;
// Its OWN cache: the bakeoff stores only {verdict, ms} under the same request
// key, and this pass needs the distribution it throws away.
const CACHE = path.join(".cache", "jev", "citation-calibration");

interface Judged { verdict: CiteVerdict | null; confidence: number | null; probabilities: Record<string, number> | null }

function cached(key: string): Judged | null {
  const f = path.join(CACHE, `${key}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as Judged;
  } catch {
    return null;
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const k = i++;
        if (k >= items.length) return;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const ix = await loadIndexes();
const cases = buildCases(ix, new Set(KINDS));
console.log(`${cases.length} cases | model ${MODEL}`);

let spend = 0;
let calls = 0;
const rows = await pool(cases, 6, async (c: CiteCase) => {
  const req = buildCiteRequest(c, ix, { question: CITE_QUESTION });
  if (!req) return { c, verdict: null, confidence: null, probabilities: null } as Judged & { c: CiteCase };
  const key = crypto.createHash("sha256").update(JSON.stringify({ MODEL, s: req.state, q: req.questions })).digest("hex");
  const hit = cached(key);
  if (hit) return { c, ...hit };
  const j = await judgeCitation({ pair: c, ix, model: MODEL, question: CITE_QUESTION });
  calls++;
  spend += j.costUsd ?? 0;
  const v: Judged = { verdict: j.verdict, confidence: j.confidence, probabilities: j.probabilities };
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, `${key}.json`), JSON.stringify(v));
  return { c, ...v };
});
console.log(`network calls ${calls} | spend $${spend.toFixed(4)}\n`);

// What the READER sees (citation-marks.ts). `supports` earns a check on its
// own; `supports_in_part` earns a check WITH a warning, which is a third thing
// and is scored apart rather than folded into either — a caveated check makes
// a weaker promise than a plain one. `about_document` produces no mark.
const shown = (v: CiteVerdict | null) =>
  v === "supports" ? "check" : v === "supports_in_part" ? "caveat" : v === "says_nothing" || v === "contradicts" ? "warning" : "none";
// A check is RIGHT on a real citation and WRONG on a repointed one. A warning
// is the reverse.
const correct = (r: { c: CiteCase; verdict: CiteVerdict | null }) => {
  const real = r.c.kind === "positive";
  // A check or a caveated check both assert the source backs the line, so both
  // are right on a real citation and wrong on a repointed one. A warning is
  // the reverse.
  return shown(r.verdict) === "warning" ? !real : real;
};

const BUCKETS = [0, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0001];
function table(label: string, mark: "check" | "caveat" | "warning", num: (r: (typeof rows)[number]) => number | null): void {
  const rs = rows.filter((r) => shown(r.verdict) === mark && num(r) !== null);
  console.log(`\n${label} — ${rs.length} ${mark}s shown`);
  if (!rs.length) return;
  console.log("  range          n   actually right");
  for (let i = 0; i < BUCKETS.length - 1; i++) {
    const inB = rs.filter((r) => (num(r) as number) >= BUCKETS[i] && (num(r) as number) < BUCKETS[i + 1]);
    if (!inB.length) continue;
    const ok = inB.filter(correct).length;
    const lo = BUCKETS[i].toFixed(2);
    const hi = Math.min(BUCKETS[i + 1], 1).toFixed(2);
    console.log(`  ${lo}–${hi}   ${String(inB.length).padStart(4)}   ${((100 * ok) / inB.length).toFixed(0).padStart(3)}%   ${"█".repeat(Math.round((20 * ok) / inB.length))}`);
  }
  const ok = rs.filter(correct).length;
  const mean = rs.reduce((t, r) => t + (num(r) as number), 0) / rs.length;
  console.log(`  overall  ${String(rs.length).padStart(4)}   ${((100 * ok) / rs.length).toFixed(0).padStart(3)}%   mean number ${mean.toFixed(2)}`);
  // Does the number separate right from wrong at all? Mean over each group.
  const m = (sel: boolean) => {
    const g = rs.filter((r) => correct(r) === sel);
    return g.length ? (g.reduce((t, r) => t + (num(r) as number), 0) / g.length).toFixed(2) : "  —";
  };
  console.log(`  separation: mean when right ${m(true)} vs when wrong ${m(false)}`);
}

const pOf = (r: (typeof rows)[number]) => (r.verdict && r.probabilities ? (r.probabilities[r.verdict] ?? null) : null);
const cOf = (r: (typeof rows)[number]) => r.confidence;

for (const mark of ["check", "caveat", "warning"] as const) {
  table(`CONFIDENCE (what we display today)`, mark, cOf);
  table(`P(verdict) (what we throw away)`, mark, pOf);
}

const out = rows.map((r) => ({ kind: r.c.kind, uuid: r.c.uuid, verdict: r.verdict, confidence: r.confidence, p: pOf(r), correct: correct(r) }));
fs.writeFileSync(".cache/eval-citation-calibration.json", JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, rows: out }, null, 2));
console.log("\nwrote .cache/eval-citation-calibration.json");
