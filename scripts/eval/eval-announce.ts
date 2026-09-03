// Promised-tool lane bakeoff (fourth sibling of eval-facts / eval-census /
// eval-complexity): should chat-loop.ts retry a round that announced a lookup
// on regex alone, or also on embedding similarity (ternlight — on-device,
// 384-dim, no network)? Writes .cache/eval-announce.json.
//
// DECISION RULE. This lane scores ANSWERS, so the two error costs are unusually
// concrete. A false fire spends ONE extra generation and the model normally
// returns the same answer — the user sees a superseded draft and a slightly
// slower turn. A miss ships "one moment while I search the atlas" AS the answer,
// with no badge (the verifier finds no claims and degrades to `unverified`), so
// the user has to re-prompt to get anything at all. Recall is therefore worth
// more than precision — but far less lopsidedly than the complexity lane, whose
// false fires were free. F2, not F3.
//
// The deterministic envelope in announcesUnmadeToolCall does most of the
// protecting: anything checkable (a link, a figure, a doc number) is an answer
// and never reaches the embedding. That is why the corpus's negatives are
// deliberately stripped of all three — measuring the lane where it is actually
// exposed rather than where the envelope already saved it.
import fs from "node:fs";
import path from "node:path";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import {
  announcesUnmadeToolCall,
  announcementMargin,
  couldAnnounce,
  matchesAnnouncementRegex,
  ANNOUNCEMENT_PROTOTYPES,
  ANSWER_PROTOTYPES,
} from "../../src/server/chat/announcement.ts";
import { config } from "../../src/server/config.ts";
import { ANNOUNCE_CASES, generatedAnswerNegatives, type AnnounceCase } from "./eval-announce-queries.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const REPORT_PATH = path.join(ROOT, ".cache", "eval-announce.json");

const BETA = 2;

interface Arm { thr: number; tp: number; fp: number; fn: number; tn: number; f1: number; fbeta: number }

function score(cases: { fire: boolean; hit: boolean }[], thr: number): Arm {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const c of cases) {
    if (c.fire && c.hit) tp++;
    else if (!c.fire && c.hit) fp++;
    else if (c.fire && !c.hit) fn++;
    else tn++;
  }
  const prec = tp + fp === 0 ? 0 : tp / (tp + fp);
  const rec = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f = (b: number) => (prec + rec === 0 ? 0 : (1 + b * b) * ((prec * rec) / (b * b * prec + rec)));
  return { thr, tp, fp, fn, tn, f1: f(1), fbeta: f(BETA) };
}

const ix = loadIndexes();
const subjects = [...new Set([...ix.entities.map((e) => e.name), ...[...ix.docMap.values()].map((d) => d.title)])]
  .filter((t) => t.length > 3 && t.length < 60)
  .sort();
const generated = generatedAnswerNegatives(subjects);
const all: AnnounceCase[] = [...ANNOUNCE_CASES, ...generated];

// Both arms are the PRODUCTION predicates, never reimplementations: the
// baseline is the regex lane behind the same envelope, the hybrid is the whole
// gate at an arbitrary margin. (An earlier hand-rolled envelope here reported 2
// false fires the shipped gate does not have — exactly the drift
// facts/similarity.ts warns about.)
const regexHit = matchesAnnouncementRegex;
const hybridHit = (t: string, m: number) => announcesUnmadeToolCall(t, m);

const scored = all.map((c) => ({ ...c, regex: regexHit(c.text) }));
const pos = scored.filter((c) => c.fire).length;

console.log(`corpus: ${all.length} (${pos} positive / ${all.length - pos} negative, ${generated.length} generated)`);
console.log(`  of the positives, ${scored.filter((c) => c.fire && c.note === "hard").length} are phrased around every regex\n`);

// How many negatives never reach the lane at all — the envelope's own share of
// the work, reported because it is the answer to "will this fire on answers
// that needed no tool call".
const shielded = all.filter((c) => !c.fire && !couldAnnounce(c.text)).length;
console.log(`envelope alone stops ${shielded}/${all.length - pos} negatives before any embedding (checkable content)\n`);

const regexArm = score(scored.map((c) => ({ fire: c.fire, hit: c.regex })), NaN);
console.log(
  `regex alone (no similarity): tp=${regexArm.tp} fp=${regexArm.fp} fn=${regexArm.fn} ` +
    `recall=${((regexArm.tp / (regexArm.tp + regexArm.fn)) * 100).toFixed(0)}%`,
);

const arms: Arm[] = [];
console.log("\nthr     tp  fp  fn   tn   recall  false-fire  F2");
for (let m = -0.1; m <= 0.5001; m += 0.025) {
  const a = score(scored.map((c) => ({ fire: c.fire, hit: c.regex || hybridHit(c.text, m) })), m);
  arms.push(a);
  const rec = (a.tp / (a.tp + a.fn)) * 100, ff = (a.fp / (a.fp + a.tn)) * 100;
  const mark = Math.abs(m - config.chatAnnouncementSimilarityMargin) < 0.0125 ? "  <- SHIPPED" : "";
  console.log(
    `${m.toFixed(3).padStart(6)}  ${String(a.tp).padStart(2)}  ${String(a.fp).padStart(2)}  ${String(a.fn).padStart(2)}  ` +
      `${String(a.tn).padStart(3)}   ${rec.toFixed(0).padStart(3)}%     ${ff.toFixed(1).padStart(4)}%     ${a.fbeta.toFixed(3)}${mark}`,
  );
}

const best = arms.slice().sort((a, b) => b.fbeta - a.fbeta)[0]!;
const zeroFf = arms.filter((a) => a.fp === 0).sort((a, b) => b.tp - a.tp)[0];
console.log(`\nbest F2 at thr=${best.thr.toFixed(3)} (shipped: ${config.chatAnnouncementSimilarityMargin})`);
if (zeroFf) console.log(`highest recall at ZERO false fires: thr=${zeroFf.thr.toFixed(3)} (tp=${zeroFf.tp}/${pos})`);

console.log("\n--- positives still missed at the shipped margin ---");
for (const c of scored.filter((c) => c.fire && !c.regex && !announcesUnmadeToolCall(c.text)))
  console.log(`  [${announcementMargin(c.text).toFixed(3)}] ${c.text.replace(/\n/g, " ").slice(0, 76)}`);
console.log("\n--- false fires at the shipped margin ---");
const shippedFf = scored.filter((c) => !c.fire && announcesUnmadeToolCall(c.text));
for (const c of shippedFf)
  console.log(`  [${c.note ?? "hand"} ${announcementMargin(c.text).toFixed(3)}] ${c.text.replace(/\n/g, " ").slice(0, 70)}`);
if (!shippedFf.length) console.log("  (none)");

// Real assistant answers, not my corpus — the arm that set the census margin.
// The population that matters is the one the guard actually sees: an assistant
// turn that made NO tool call. Every fire here would have been a wasted round.
let realFires: string[] = [];
if (process.env.DATABASE_URL) {
  try {
    const { sql } = await import("../../src/server/db.ts");
    const rows = (await sql`
      SELECT content FROM messages
      WHERE role = 'assistant'
        AND coalesce(jsonb_array_length(tool_calls), 0) = 0
        AND length(content) BETWEEN 10 AND 4000
      ORDER BY created_at DESC LIMIT 500`) as { content: string }[];
    const seen = [...new Set(rows.map((r) => r.content))];
    const reachable = seen.filter((t) => couldAnnounce(t));
    realFires = reachable.filter((t) => announcesUnmadeToolCall(t));
    console.log(`\nreal tool-free assistant answers from DATABASE_URL: ${seen.length}`);
    console.log(`  reach the lane at all (past the envelope): ${reachable.length}`);
    console.log(`  the guard would RETRY:                     ${realFires.length}`);
    for (const t of realFires.slice(0, 25)) console.log(`    + ${t.replace(/\n/g, " ").slice(0, 76)}`);
    if (!realFires.length) console.log("    (none)");
    await sql.end();
  } catch (err) {
    console.log(`\n!! real-traffic check FAILED (${(err as Error).message}) — corpus numbers above stand, but the`);
    console.log("!! check that set the census margin did NOT run. Bring a DB up before trusting a lower margin.");
  }
} else {
  console.log("\n(no DATABASE_URL — skipped the real-traffic false-fire check, the one that set the census margin)");
}

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      shipped: config.chatAnnouncementSimilarityMargin,
      // Recorded so a report can be read back without guessing which prototype
      // sets produced it — the margins move when either set changes.
      prototypes: { positive: ANNOUNCEMENT_PROTOTYPES, negative: ANSWER_PROTOTYPES },
      regexArm,
      arms,
      realFires,
    },
    null,
    1,
  ),
);
console.log(`\nwrote ${REPORT_PATH}`);
