// Jev refute screen bakeoff (verify/refute-screen.ts, CHAT_REFUTE_SCREEN).
//
//   pnpm eval:refute-screen           # the Jev screen over every case (cached)
//   pnpm eval:refute-screen --gemma   # + the SHIPPED per-paragraph gemma refute on the same paragraphs
//
// Cases (eval-refute-screen-cases.ts): every paragraph of the stored answers
// in eval-corpora/{evidence,fable}, plus planted name/number/list/fabrication
// mutations. Both arms read the production per-paragraph evidence (schema +
// param rows + the turn's budgeted evidence) — the screen then narrows it and
// adds the cited docs from the index exactly as it does live.
//
// The gemma arm is the production refuter itself (createParagraphRefuter with
// the screen off) under the production 45 s timeout, so a runaway generation
// records as the failure it is live. "Gemma caught" means ≥1 span-validated
// candidate BEFORE confirm — the stage the screen sits in front of. Its
// per-paragraph numbers had never been recorded before this eval: they are
// the incumbent baseline.
//
// Everything is cached on disk (.cache/jev/refute-screen, .cache/eval-refute-
// screen/gemma), keyed on everything that can change an answer: a rerun makes
// zero network calls and prints identical numbers. Transient failures are not
// cached; a gemma timeout is (it is a real outcome).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { askJev, type JevRun } from "../../src/server/jev.ts";
import { config } from "../../src/server/config.ts";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { openrouterJson } from "../../src/server/chat/llm.ts";
import { sliceModels } from "../../src/server/chat/verify/sliced-verifier.ts";
import { createParagraphRefuter } from "../../src/server/chat/verify/paragraph-refute.ts";
import { buildScreenRequest, readScreen, screenParagraph, type ScreenResult } from "../../src/server/chat/verify/refute-screen.ts";
import { buildAllCases, loadRuns, prodEvidence, type Case } from "./eval-refute-screen-cases.ts";
import { printReport, type GemmaOutcome, type Row } from "./eval-refute-screen-report.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const GEMMA = process.argv.includes("--gemma");
const CONC = 4;
const JEV_MODEL = config.chatRefuteScreenModel || config.chatJevModel;
const CACHE = { jev: path.join(ROOT, ".cache", "jev", "refute-screen"), gemma: path.join(ROOT, ".cache", "eval-refute-screen", "gemma") };

if (!config.openrouterApiKey && !fs.existsSync(CACHE.jev)) {
  console.error("OPENROUTER_API_KEY is not set and there is no cache to replay — nothing to measure.");
  process.exit(1);
}
const gemmaModel = GEMMA ? sliceModels().refute : "";
if (GEMMA && !gemmaModel) {
  console.error("--gemma needs CHAT_VERIFIER_MODEL (or a refute= entry in CHAT_VERIFIER_SLICE_MODELS).");
  process.exit(1);
}

const key = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
function cacheGet<T>(dir: string, k: string): T | null {
  const f = path.join(dir, `${k}.json`);
  try {
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : null;
  } catch {
    return null;
  }
}
function cachePut(dir: string, k: string, v: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${k}.json`), JSON.stringify(v));
}
// One request per key even when two cases share it and run concurrently —
// otherwise a first run scores two different outcomes where its replay scores one.
const pending = new Map<string, Promise<unknown>>();
function once<T>(k: string, fn: () => Promise<T>): Promise<T> {
  if (!pending.has(k)) pending.set(k, fn());
  return pending.get(k) as Promise<T>;
}
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const k = i++;
      if (k >= items.length) return;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

const ix = loadIndexes();
const runs = loadRuns();
const byRun = new Map(runs.map((r) => [r.id, r]));
const cases = buildAllCases(runs, ix);
const spent = { jevNew: 0, jevAll: 0, jevCalls: 0, gemmaCalls: 0, jevErrors: 0, gemmaErrors: 0 };

type CachedJev = Omit<JevRun, "answers"> & { answers: JevRun["answers"] };
async function jevArm(c: Case): Promise<ScreenResult | null> {
  const run = byRun.get(c.run)!;
  const evidence = prodEvidence(ix, run, c.paragraph);
  const req = buildScreenRequest({ question: run.question, paragraph: c.paragraph, evidence, ix });
  if (!req.fits || req.statements.length === 0) return screenParagraph({ question: run.question, paragraph: c.paragraph, evidence, ix, model: JEV_MODEL }); // sends nothing
  const k = key({ model: JEV_MODEL, state: req.state, questions: req.questions });
  const jr = await once(`jev:${k}`, async () => {
    const hit = cacheGet<CachedJev>(CACHE.jev, k);
    if (hit) return hit;
    try {
      const fresh = await askJev({ state: req.state, questions: req.questions, model: JEV_MODEL, timeoutMs: 30_000 });
      spent.jevCalls++;
      spent.jevNew += fresh.cost ?? 0;
      cachePut(CACHE.jev, k, fresh);
      return fresh;
    } catch (e) {
      spent.jevErrors++;
      console.warn(`  jev ${c.id}: ${(e as Error).message.slice(0, 160)}`);
      return null;
    }
  });
  if (!jr) return null;
  spent.jevAll += jr.cost ?? 0;
  return readScreen(req, jr);
}

async function gemmaArm(c: Case): Promise<GemmaOutcome | null> {
  const run = byRun.get(c.run)!;
  const evidence = prodEvidence(ix, run, c.paragraph);
  const k = key({ model: gemmaModel, q: run.question, p: c.paragraph, e: evidence });
  return once(`gemma:${k}`, () => gemmaCall(k, run.question, c.paragraph, evidence));
}
async function gemmaCall(k: string, question: string, paragraph: string, evidence: ReturnType<typeof prodEvidence>): Promise<GemmaOutcome> {
  const hit = cacheGet<GemmaOutcome>(CACHE.gemma, k);
  if (hit) return hit;
  const timeoutMs = config.chatVerifierSliceTimeoutMs;
  const refuter = createParagraphRefuter({
    call: openrouterJson, model: gemmaModel, ix, question, evidence: () => evidence,
    timeoutMs, concurrency: 1, maxParagraphs: 100, screenMode: "off",
  });
  const t0 = Date.now();
  refuter.submit(0, paragraph);
  const [r] = await refuter.settle(timeoutMs + 5000);
  const wallMs = Date.now() - t0;
  spent.gemmaCalls++;
  const out: GemmaOutcome = {
    parsed: r.parsed, timedOut: r.timedOut || (!r.parsed && wallMs >= timeoutMs * 0.95),
    candidates: r.contradictions.map((x) => ({ answer_span: x.answer_span, evidence_span: x.evidence_span, why: x.why })),
    discarded: r.discarded, latencyMs: r.latencyMs, wallMs, usage: r.usage,
  };
  if (!out.parsed && !out.timedOut) {
    spent.gemmaErrors++; // transport/unparseable — not cached, retried next run
    return out;
  }
  cachePut(CACHE.gemma, k, out);
  return out;
}

console.log(`${cases.length} cases from ${runs.length} stored answers — Jev ${JEV_MODEL}${GEMMA ? `, gemma arm ${gemmaModel}` : ""}`);
const rows: Row[] = await pool(cases, CONC, async (c) => {
  const [screen, gemma] = await Promise.all([jevArm(c), GEMMA ? gemmaArm(c) : Promise.resolve(null)]);
  return { c, screen, gemma };
});
await printReport(rows, { gemmaModel, spent, gemmaRan: GEMMA });
const out = path.join(ROOT, ".cache", "eval-refute-screen.json");
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), jevModel: JEV_MODEL, gemmaModel, spent, rows }, null, 1));
console.log(`\nwrote ${out}`);
