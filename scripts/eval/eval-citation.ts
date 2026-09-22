// A1 bakeoff — "is this claim backed up by the doc it references?"
//
//   pnpm eval:citation
//
// One judge, Jev — one Choice per (claim, cited doc) pair, in two question
// variants:
// the original three options, and the same plus `about_document` — the
// pointer option (a claim ABOUT a document, which the document cannot state).
// Children-in-state was measured on 2026-09-22 and changed nothing on real
// citations, so it is no longer an arm. The lexical baseline this was first
// scored against (findLowOverlapCitations, word overlap) was deleted the same
// day; its numbers are kept in docs/plans/jev-typesafe.md §A1.
//
// The shipped `refute` auditor is NOT an arm here, and deliberately: every
// negative below is built by repointing a citation's LINK, which leaves the
// answer prose byte-identical. Refute's input is (question, answer, pooled
// evidence) and it has no way to resolve a UUID to a document, so its output
// cannot differ between a positive and its repointed negative. It scores 0 on
// every wrong-doc class by construction, not by weakness. Running it would
// measure the harness, not the auditor. (Re-pointing refute at a single
// document instead would be a different auditor that we invented, which is
// not what "how does the current one do?" asks.)
//
// DECISION RULE: decide on the FALSE-FLAG RATE OVER REAL CITATIONS first.
// A check that flags correct citations is noise whatever its catch rate, and
// `says_nothing` on a correctly-cited parent is the expected failure (since
// atomization a parent's content excludes its children's text). Catch rate on
// same_title / cited_elsewhere is the upside; read it second.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { judgeCitation, buildCiteRequest, CITE_QUESTION, CITE_QUESTION_3, type CiteVerdict } from "../../src/server/chat/verify/cite-support.ts";
import { buildCases, type CaseKind, type CiteCase } from "./eval-citation-cases.ts";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { config } from "../../src/server/config.ts";

const KINDS: CaseKind[] = ["positive", "random", "parent", "sibling", "same_title", "cited_elsewhere"];
const CONCURRENCY = 6;
const MODEL = process.env.JEV_MODEL ?? config.chatJevModel;
const CACHE = path.join(".cache", "jev", "citation");

// Disk cache keyed on everything that can change an answer, so a rerun makes
// ZERO network requests and prints identical numbers.
function cacheKey(model: string, state: unknown, questions: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify({ model, state, questions })).digest("hex");
}
function cached<T>(key: string): T | null {
  const f = path.join(CACHE, `${key}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
}
function putCache(key: string, v: unknown): void {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, `${key}.json`), JSON.stringify(v));
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

const ix = loadIndexes();
const cases = buildCases(ix, new Set(KINDS));
const positives = cases.filter((c) => c.kind === "positive");
console.log(`${cases.length} cases from ${new Set(cases.map((c) => c.source)).size} stored answers — ${positives.length} real citations + ${cases.length - positives.length} repointed negatives`);
if (!cases.length) {
  console.log("no cases — is the atlas index built? (pnpm build:index)");
  process.exit(0);
}

// ── Jev ────────────────────────────────────────────────────────────
type Q = typeof CITE_QUESTION | typeof CITE_QUESTION_3;
async function jevVerdict(c: CiteCase, question: Q): Promise<{ verdict: CiteVerdict | null; cost: number; ms: number | null; cacheHit: boolean }> {
  const req = buildCiteRequest(c, ix, { question });
  if (!req) return { verdict: null, cost: 0, ms: null, cacheHit: true };
  const key = cacheKey(MODEL, req.state, req.questions);
  const hit = cached<{ verdict: CiteVerdict | null; ms: number | null }>(key);
  if (hit) return { ...hit, cost: 0, cacheHit: true };
  const j = await judgeCitation({ pair: c, ix, model: MODEL, question });
  putCache(key, { verdict: j.verdict, ms: j.latencyMs });
  return { verdict: j.verdict, cost: j.costUsd ?? 0, ms: j.latencyMs, cacheHit: false };
}

interface Row { c: CiteCase; q3: CiteVerdict | null; q4: CiteVerdict | null }

let spend = 0;
let calls = 0;
const rows: Row[] = await pool(cases, CONCURRENCY, async (c) => {
  const [a, b] = [await jevVerdict(c, CITE_QUESTION_3), await jevVerdict(c, CITE_QUESTION)];
  spend += a.cost + b.cost;
  calls += (a.cacheHit ? 0 : 1) + (b.cacheHit ? 0 : 1);
  return { c, q3: a.verdict, q4: b.verdict };
});

// A "flag" is any verdict that would surface something to the user:
// contradicts (hard) or says_nothing (soft note). supports surfaces nothing.
const flags = (v: CiteVerdict | null) => v === "contradicts" || v === "says_nothing";
const pct = (n: number, d: number) => (d === 0 ? "   —" : `${((100 * n) / d).toFixed(0).padStart(3)}%`);

console.log(`\nnetwork calls ${calls} (rest cached) | spend $${spend.toFixed(4)} | model ${MODEL}\n`);
console.log("                     n   3-option  +pointer      (flag rate; for POSITIVE this is the FALSE-flag rate)");
for (const k of KINDS) {
  const rs = rows.filter((r) => r.c.kind === k);
  if (!rs.length) continue;
  const p = rs.filter((r) => flags(r.q3)).length;
  const kd = rs.filter((r) => flags(r.q4)).length;
  console.log(`  ${k.padEnd(16)} ${String(rs.length).padStart(4)}   ${pct(p, rs.length)}   ${pct(kd, rs.length)}${k === "positive" ? "   <- LOWER IS BETTER" : ""}`);
}

// Verdict mix on the real citations — says_nothing is the atomization tax and
// contradicts on a correct citation is the expensive error.
for (const [label, sel] of [["3-option", (r: Row) => r.q3], ["+pointer", (r: Row) => r.q4]] as const) {
  const mix = (k: CaseKind) => {
    const rs = rows.filter((r) => r.c.kind === k);
    const c = (v: string) => rs.filter((r) => sel(r) === v).length;
    return `supports ${c("supports")} / about_document ${c("about_document")} / says_nothing ${c("says_nothing")} / contradicts ${c("contradicts")} / failed ${rs.filter((r) => sel(r) === null).length}`;
  };
  console.log(`\n${label} verdict mix on REAL citations: ${mix("positive")}`);
  console.log(`${label} verdict mix on same_title:     ${mix("same_title")}`);
}

// There is no gold label on a real citation — "positive" means a model wrote
// it. So every flagged one is printed with the start of its cited doc, to be
// adjudicated by reading: is it a false flag, or a real mis-citation caught?
console.log(`\nREAL citations flagged by +pointer — adjudicate each (false flag, or a real catch?):`);
for (const r of rows.filter((r) => r.c.kind === "positive" && flags(r.q4))) {
  const d = ix.docMap.get(r.c.uuid)!;
  console.log(`  [${r.q4}] ${r.c.uuid}\n     claim: ${r.c.claim.slice(0, 220)}\n     doc:   ${d.title} — ${d.content.replace(/\s+/g, " ").slice(0, 220)}`);
}

const out = path.join(".cache", "eval-citation.json");
fs.mkdirSync(".cache", { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, spend, rows }, null, 2));
console.log(`\nwrote ${out}`);
