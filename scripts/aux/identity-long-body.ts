// Thread 7 of docs/research/identity-swap-detection.md: the >3-line residual.
//
//   bun scripts/aux/identity-long-body.ts [--origin <url>] [--refresh]
//
// The gate used to route a body of more than SHORT_BODY_MAX_LINES lines to
// lineOverlap, and a lint pass that re-indents a bullet list changes EVERY
// line, so 15 real cosmetic edits were badged "identity changed" while
// their word containment was 1.000. This scores the candidate fixes on both
// sides of the trade:
//
//   false flags — the real, human-labelled edits in atlas_history (lint/typo
//     must never be badged; semantic edits mostly must not be either);
//   misses      — SYNTHETIC swaps, because the real corpus holds no true swap:
//     one live body paired with an unrelated one, and the hard case, with a
//     SIBLING (same parent) that shares its template. The bakeoff's positives
//     are one-liners only, so the multi-line ones are built here.
//
// CAVEAT: "sibling" here means same `parentId`, and heading depth is capped at
// 6, so about six pairs in seven share a more distant ancestor and are easier
// than true siblings. The rules compare fairly with each other; the absolute
// miss rates are too low. identity-search-vector.ts takes siblings by document
// number and scores real retitles — prefer it.

import { lcsOps } from "../../src/lib/diffCore.ts";
import {
  bodyWhollyReplaced, bodyWordsKept, lineOverlap, orderedWordContainment, sameTitle, words,
  REPLACE_MAX_OVERLAP, REPLACE_MAX_WORD_OVERLAP, SHORT_BODY_MAX_LINES, JUDGEABLE_MIN_WORDS,
} from "../../src/server/preview/identity.ts";
import { loadCorpus, lineCount, wordCount, prng, type LiveDoc } from "./identity-corpus.ts";

const args = process.argv.slice(2);
const ORIGIN = args.includes("--origin") ? args[args.indexOf("--origin") + 1] : "https://atlas.redline.support";


// Candidate B's measure: lineOverlap, but two lines are equal when their WORDS
// are equal, so a changed bullet glyph or indent no longer breaks the match.
function lineOverlapByWords(a: string | undefined, b: string | undefined): number {
  const ls = (t: string | undefined) => (t ?? "").split("\n").map((l) => words(l).join(" ")).filter(Boolean);
  const la = ls(a), lb = ls(b);
  if (la.length === 0 && lb.length === 0) return 1;
  if (la.length === 0 || lb.length === 0) return 0;
  return lcsOps(la, lb).filter(([op]) => op === "=").length / la.length;
}

// The word measure without orderedWordContainment's binary fallback, which
// answers 0 for any change at all to a body over ~632 words. Too large even
// for the full comparison, it falls back to the line measure.
const capHit = (a: string, b: string) => words(a).length * words(b).length > 400_000;
const wordFixed = (a: string, b: string): number => bodyWordsKept(a, b) ?? lineOverlapByWords(a, b);

interface Row { before: string; after: string; lines: number; line: number; lineW: number; word: number; wordF: number; shipped: boolean }
function score(before: string, after: string): Row | null {
  if (wordCount(before) < JUDGEABLE_MIN_WORDS) return null; // the gate declines these
  return {
    before, after, lines: lineCount(before),
    line: lineOverlap(before, after), lineW: lineOverlapByWords(before, after),
    word: orderedWordContainment(before, after), wordF: wordFixed(before, after),
    shipped: bodyWhollyReplaced(before, after),
  };
}

const L = REPLACE_MAX_OVERLAP, W = REPLACE_MAX_WORD_OVERLAP;
const short = (r: Row) => r.lines <= SHORT_BODY_MAX_LINES;
const CANDIDATES: [string, (r: Row) => boolean][] = [
  ["routed           word if <=3 lines, else line (shipped until 2026-09-29)", (r) => (short(r) ? r.word <= W : r.line <= L)],
  ["A  both, capped  line<=0.15 AND word<=0.50, word binary past the cost cap", (r) => r.line <= L && r.word <= W],
  ["shipped          line<=0.15 AND word(full)<=0.50 — bodyWhollyReplaced itself", (r) => r.shipped],
  ["B  line-by-words route by size, long lines compared on words", (r) => (short(r) ? r.word <= W : r.lineW <= L)],
  ["B' both-by-words line-by-words<=0.15 AND word(full)<=0.50", (r) => r.lineW <= L && r.wordF <= W],
  ["C  word only     word(full)<=0.50 on every body", (r) => r.wordF <= W],
];

const main = async () => {
  const { docs, edits, elided } = await loadCorpus(ORIGIN, args.includes("--refresh"));
  const live = Object.values(docs).filter((d) => wordCount(d.content) >= JUDGEABLE_MIN_WORDS);
  console.log(`live atlas: ${Object.keys(docs).length} docs, ${live.length} judgeable; real edits: ${edits.length} (${elided} elided diffs dropped)`);

  const real = (kinds: string[]) => edits.filter((e) => kinds.includes(e.kind)).map((e) => score(e.before, e.after)).filter(Boolean) as Row[];
  const cosmetic = real(["lint", "typo"]);
  const semantic = real(["semantic"]);

  // Synthetic swaps, by the size of the OLD body (the side the gate routes on).
  const { pick } = prng(7);
  const band = (lo: number, hi: number) => live.filter((d) => { const n = lineCount(d.content); return n >= lo && n <= hi; });
  const pairs = (olds: LiveDoc[], news: (o: LiveDoc) => LiveDoc[], n: number): Row[] => {
    const out: Row[] = [];
    for (let i = 0; i < n * 3 && out.length < n; i++) {
      const o = pick(olds);
      const pool = news(o);
      if (!pool.length) continue;
      const c = pick(pool);
      // Same title never reaches the body test, and an identical body is not a swap.
      if (c.id === o.id || sameTitle(c.title, o.title) || c.content === o.content) continue;
      const r = score(o.content ?? "", c.content ?? "");
      if (r) out.push(r);
    }
    return out;
  };
  const byParent = new Map<string, LiveDoc[]>();
  for (const d of live) if (d.parentId) (byParent.get(d.parentId) ?? byParent.set(d.parentId, []).get(d.parentId)!).push(d);
  const sibsOf = (o: LiveDoc) => (o.parentId ? (byParent.get(o.parentId) ?? []).filter((s) => s.id !== o.id) : []);
  // A sibling of similar size is the realistic repurposing: a slot in a
  // template family now holding its neighbour.
  const sibsLike = (o: LiveDoc) => sibsOf(o).filter((s) => lineCount(s.content) > SHORT_BODY_MAX_LINES);

  const BANDS: [string, number, number][] = [["1-3 lines", 1, 3], ["4-20 lines", 4, 20], [">20 lines", 21, 1e9]];
  const pos = BANDS.map(([name, lo, hi]) => {
    const olds = band(lo, hi);
    return {
      name, olds: olds.length,
      unrelated: pairs(olds, () => live, 1000),
      sibling: pairs(olds, lo > SHORT_BODY_MAX_LINES ? sibsLike : sibsOf, 1000),
    };
  });

  const rate = (xs: Row[], f: (r: Row) => boolean) => (xs.length ? `${((100 * xs.filter(f).length) / xs.length).toFixed(2).padStart(6)}% (${xs.filter(f).length}/${xs.length})` : "   n/a");
  const not = (f: (r: Row) => boolean) => (r: Row) => !f(r);
  const long = (r: Row) => !short(r);

  console.log(`\n=== FALSE FLAGS on real edits (lower is better) ===`);
  for (const [name, f] of CANDIDATES) {
    console.log(`\n  ${name}`);
    console.log(`    cosmetic  short ${rate(cosmetic.filter(short), f)}   long ${rate(cosmetic.filter(long), f)}`);
    console.log(`    semantic  short ${rate(semantic.filter(short), f)}   long ${rate(semantic.filter(long), f)}`);
  }

  console.log(`\n=== MISSES on synthetic swaps, by old-body size (lower is better) ===`);
  for (const p of pos) console.log(`  population ${p.name}: ${p.olds} live bodies; ${p.unrelated.length} unrelated pairs, ${p.sibling.length} sibling pairs`);
  for (const [name, f] of CANDIDATES) {
    console.log(`\n  ${name}`);
    for (const p of pos) console.log(`    ${p.name.padEnd(11)} unrelated missed ${rate(p.unrelated, not(f))}   sibling missed ${rate(p.sibling, not(f))}`);
  }

  console.log(`\n=== the cost cap (both bodies over ~632 words) ===`);
  const allReal = [...cosmetic, ...semantic];
  console.log(`  real edits that hit it: ${allReal.filter((r) => capHit(r.before, r.after)).length}/${allReal.length}` +
    `  (cosmetic: ${cosmetic.filter((r) => capHit(r.before, r.after)).length}, of which word=0 today: ${cosmetic.filter((r) => capHit(r.before, r.after) && r.word === 0).length}, compared in full: ${cosmetic.filter((r) => capHit(r.before, r.after) && r.wordF === 0).length})`);
  for (const p of pos) console.log(`  synthetic ${p.name.padEnd(11)} pairs that hit it: ${[...p.unrelated, ...p.sibling].filter((r) => capHit(r.before, r.after)).length}`);

  // Does comparing lines by their words move any body across the routing line?
  const moved = [...allReal].filter((r) => {
    const n = (r.before ?? "").split("\n").map((l) => words(l).join(" ")).filter(Boolean).length;
    return (n <= SHORT_BODY_MAX_LINES) !== short(r);
  }).length;
  console.log(`\nreal edits whose short/long routing would change if punctuation-only lines were dropped: ${moved}/${allReal.length}`);

  // Candidate C moves long bodies onto the word measure, so its threshold is
  // swept over LONG bodies only — the short-body threshold is already measured.
  console.log(`\n=== C's threshold, over bodies of more than ${SHORT_BODY_MAX_LINES} lines ===`);
  console.log(`  word<=t   cosmetic flagged        semantic flagged        unrelated missed        sibling missed`);
  const longPos = { unrelated: [...pos[1].unrelated, ...pos[2].unrelated], sibling: [...pos[1].sibling, ...pos[2].sibling] };
  for (const t of [0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8]) {
    const f = (r: Row) => r.wordF <= t;
    console.log(`  ${t.toFixed(2)}     ${rate(cosmetic.filter(long), f)}   ${rate(semantic.filter(long), f)}   ${rate(longPos.unrelated, not(f))}   ${rate(longPos.sibling, not(f))}${t === W ? "  <- short-body value" : ""}`);
  }

  if (args.includes("--samples")) {
    const head = (t: string) => t.split("\n").slice(0, 3).map((l) => l.trim().slice(0, 100)).join(" / ");
    console.log(`\nsibling swaps (4-20 lines) C still misses — first 6:`);
    for (const r of pos[1].sibling.filter((r) => r.wordF > W).slice(0, 6)) console.log(`  word=${r.word.toFixed(3)} line=${r.line.toFixed(3)}\n    old: ${head(r.before)}\n    new: ${head(r.after)}`);
    console.log(`\nsibling swaps (4-20 lines) the shipped gate misses and C catches — first 6:`);
    for (const r of pos[1].sibling.filter((r) => !r.shipped && r.wordF <= W).slice(0, 6)) console.log(`  word=${r.word.toFixed(3)} line=${r.line.toFixed(3)}\n    old: ${head(r.before)}\n    new: ${head(r.after)}`);
    console.log(`\nreal semantic edits to long bodies C flags — first 6:`);
    for (const r of semantic.filter((r) => long(r) && r.wordF <= W).slice(0, 6)) console.log(`  word=${r.word.toFixed(3)} line=${r.line.toFixed(3)}\n    old: ${head(r.before)}\n    new: ${head(r.after)}`);
  }

  const sibLong = pos[1].sibling;
  console.log(`\nsibling swaps, 4-20 lines — where the two measures sit:`);
  for (const k of ["line", "lineW", "word"] as const) {
    const xs = sibLong.map((r) => r[k]).sort((a, b) => a - b);
    const q = (p: number) => xs[Math.floor(p * (xs.length - 1))].toFixed(3);
    console.log(`  ${k.padEnd(6)} p05=${q(0.05)} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} p95=${q(0.95)}`);
  }
};

await main();
