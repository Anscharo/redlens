// Does the Qwen3 embedding tell the identity gate anything the word measure
// does not? Head to head on the SAME pairs: real labelled edits against
// synthetic sibling and unrelated swaps.
//
//   bun scripts/aux/identity-embedding-vs-word.ts [--band mixed|mid] [--embed]
//
//   --band mixed  (default) every real edit, and swaps drawn from the whole
//                 atlas — so mostly one-line bodies, like the atlas itself.
//   --band mid    bodies of 4 to 20 lines only, where the gate is weakest
//                 (thread 7: the line measure misses about half the sibling
//                 swaps there). Every old body in the band is used, with up
//                 to three distinct siblings each: the band is small enough
//                 that sampling with replacement repeats pairs.
//   --embed       fetch the vectors the cache lacks (needs OPENROUTER_API_KEY).
//                 Without it the script makes no network call for vectors and
//                 drops the pairs it cannot score.
//
// Three questions: how well each measure ranks edits above swaps alone, whether
// the embedding catches swaps the shipped gate misses, and what whole rules
// built from both would do. Every rule is reported on two disjoint halves of
// the pairs, and the rule search in section 4 picks on one half and reports
// the other, because thresholds chosen on a corpus flatter that corpus.
//
// CAVEAT: "sibling" here means same `parentId`, and heading depth is capped at
// 6, so about six pairs in seven share a more distant ancestor and are easier
// than true siblings. The rules compare fairly with each other; the absolute
// miss rates are too low. identity-search-vector.ts takes siblings by document
// number and scores real retitles — prefer it.

import { bodyWhollyReplaced, bodyWordsKept, lineOverlap, JUDGEABLE_MIN_WORDS, REPLACE_MAX_OVERLAP, SHORT_BODY_MAX_LINES } from "../../src/server/preview/identity.ts";
import { loadCorpus, lineCount, wordCount, prng, quantile, qwenVectors, dot, type LiveDoc } from "./identity-corpus.ts";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ORIGIN = opt("--origin", "https://atlas.redline.support");
const BAND = opt("--band", "mixed");
const MID: [number, number] = [SHORT_BODY_MAX_LINES + 1, 20];

type P = { group: string; a: string; b: string; word: number; line: number; qwen: number; flagged: boolean };
const pairs: P[] = [];
const add = (group: string, a: string, b: string) => {
  if (wordCount(a) < JUDGEABLE_MIN_WORDS || !b.trim()) return;
  pairs.push({ group, a, b, word: bodyWordsKept(a, b) ?? 0, line: lineOverlap(a, b), qwen: NaN, flagged: bodyWhollyReplaced(a, b) });
};

const { docs, edits } = await loadCorpus(ORIGIN);
const { pick, rnd } = prng(7);
const live = Object.values(docs).filter((d) => wordCount(d.content) >= JUDGEABLE_MIN_WORDS);
const byParent = new Map<string, LiveDoc[]>();
for (const d of live) if (d.parentId) (byParent.get(d.parentId) ?? byParent.set(d.parentId, []).get(d.parentId)!).push(d);
const inMid = (t: string | undefined) => { const n = lineCount(t); return n >= MID[0] && n <= MID[1]; };
const titleKey = (d: LiveDoc) => (d.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
// Same title never reaches the body test, and an identical body is not a swap.
const swappable = (o: LiveDoc, c: LiveDoc) => o.id !== c.id && titleKey(o) !== titleKey(c) && o.content !== c.content;

if (BAND === "mid") {
  for (const e of edits) if (inMid(e.before)) add(e.kind, e.before, e.after);
  const olds = live.filter((d) => inMid(d.content));
  const seen = new Set<string>();
  // Up to three siblings for each old body, so that one family of a hundred
  // near-identical documents cannot outweigh the rest of the band.
  for (const o of olds) {
    const sibs = (byParent.get(o.parentId ?? "") ?? []).filter((c) => lineCount(c.content) > SHORT_BODY_MAX_LINES && swappable(o, c));
    for (let k = 0; k < 3 && sibs.length; k++) {
      const [c] = sibs.splice(Math.floor(rnd() * sibs.length), 1);
      add("sibling", o.content!, c.content!);
    }
  }
  for (let i = 0; i < 6000 && seen.size < 1500; i++) {
    const o = pick(olds), c = pick(live);
    if (!swappable(o, c) || seen.has(`${o.id}>${c.id}`)) continue;
    seen.add(`${o.id}>${c.id}`);
    add("unrelated", o.content!, c.content!);
  }
} else {
  for (const e of edits) add(e.kind, e.before, e.after);
  const families = [...byParent.values()].filter((g) => g.length >= 2);
  for (let i = 0; i < 1500; i++) {
    const a = pick(live), b = pick(live);
    if (a.id !== b.id && a.content !== b.content) add("unrelated", a.content!, b.content!);
    const g = pick(families), x = pick(g), y = pick(g);
    if (x.id !== y.id && x.content !== y.content) add("sibling", x.content!, y.content!);
  }
}

const vecs = await qwenVectors(pairs.flatMap((p) => [p.a, p.b]), args.includes("--embed"));
for (const p of pairs) p.qwen = dot(vecs.get(p.a), vecs.get(p.b));
const unscored = pairs.filter((p) => Number.isNaN(p.qwen)).length;
const scored = pairs.filter((p) => !Number.isNaN(p.qwen));
// Shuffle once, so that the two halves below are random and not an artefact of
// the order the pairs were built in (siblings arrive grouped by family).
for (let i = scored.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [scored[i], scored[j]] = [scored[j], scored[i]]; }

const isEdit = (p: P) => p.group === "lint" || p.group === "typo" || p.group === "semantic";
const cosmetic = (p: P) => p.group === "lint" || p.group === "typo";
const E = scored.filter(isEdit), S = scored.filter((p) => p.group === "sibling"), U = scored.filter((p) => p.group === "unrelated");
console.log(`band ${BAND}: ${E.length} real edits (${E.filter(cosmetic).length} cosmetic), ${S.length} sibling swaps, ${U.length} unrelated swaps; ${unscored} pairs dropped for want of a vector`);

// AUC: the chance that a random edit scores HIGHER than a random swap.
function auc(pos: number[], neg: number[]) {
  const all = [...pos.map((v) => [v, 1] as const), ...neg.map((v) => [v, 0] as const)].sort((a, b) => a[0] - b[0]);
  let rankSum = 0, i = 0;
  while (i < all.length) {
    let j = i;
    while (j < all.length && all[j][0] === all[i][0]) j++;
    for (let k = i; k < j; k++) if (all[k][1]) rankSum += (i + j + 1) / 2;
    i = j;
  }
  return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}
const pc = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) : "n/a");
const count = (xs: P[], f: (p: P) => boolean) => xs.filter(f).length;

console.log("\n=== 1. one measure alone: does it rank real edits above swaps? (AUC, 1 = perfect) ===");
for (const k of ["line", "word", "qwen"] as const) {
  console.log(`  ${k.padEnd(5)} edits vs siblings ${auc(E.map((p) => p[k]), S.map((p) => p[k])).toFixed(4)}   edits vs unrelated ${auc(E.map((p) => p[k]), U.map((p) => p[k])).toFixed(4)}   semantic edits only vs siblings ${auc(E.filter((p) => !cosmetic(p)).map((p) => p[k]), S.map((p) => p[k])).toFixed(4)}`);
}
const qs = (xs: number[]) => [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => quantile(xs, p).toFixed(3)).join("  ");
console.log(`\n  p05 p25 p50 p75 p95`);
for (const k of ["line", "word", "qwen"] as const) {
  console.log(`  ${k.padEnd(5)} real edits ${qs(E.map((p) => p[k]))}   siblings ${qs(S.map((p) => p[k]))}   unrelated ${qs(U.map((p) => p[k]))}`);
}
console.log("\n  at a matched miss rate on siblings, how many real edits does each flag?");
for (const miss of [0.05, 0.1, 0.15, 0.2, 0.3]) {
  const row = (["word", "qwen"] as const).map((k) => {
    const t = quantile(S.map((p) => p[k]), 1 - miss); // flag when score <= t
    return `${k}<=${t.toFixed(3)} flags ${count(E, (p) => p[k] <= t)}/${E.length} (${count(E, (p) => p[k] <= t && cosmetic(p))} cosmetic)`;
  });
  console.log(`  siblings missed ${(miss * 100).toFixed(0).padStart(2)}%:  ${row.join("   |   ")}`);
}

console.log("\n=== 2. swaps the shipped gate MISSES: can a second measure catch them? ===");
const missed = [...S, ...U].filter((p) => !p.flagged);
const okEdits = E.filter((p) => !p.flagged);
console.log(`  missed swaps: ${missed.length} (${count(missed, (p) => p.group === "sibling")} sibling); real edits not flagged: ${okEdits.length}`);
console.log(`  qwen  missed swaps ${qs(missed.map((p) => p.qwen))}   unflagged edits ${qs(okEdits.map((p) => p.qwen))}`);
console.log(`  word  missed swaps ${qs(missed.map((p) => p.word))}   unflagged edits ${qs(okEdits.map((p) => p.word))}`);
for (const [k, ts] of [["qwen", [0.6, 0.7, 0.75, 0.8, 0.85]], ["word", [0.5, 0.55, 0.6, 0.7, 0.8]]] as const) {
  for (const t of ts) {
    console.log(`  also flag when ${k}<=${t.toFixed(2)}: catches ${count(missed, (p) => p[k] <= t)}/${missed.length} missed swaps, newly flags ${count(okEdits, (p) => p[k] <= t)}/${okEdits.length} real edits (${count(okEdits, (p) => p[k] <= t && cosmetic(p))} cosmetic)`);
  }
}
const corr = (xs: number[], ys: number[]) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return (n / Math.sqrt(dx * dy)).toFixed(3);
};
console.log(`  correlation of word and qwen: over real edits ${corr(E.map((p) => p.word), E.map((p) => p.qwen))}, over sibling swaps ${corr(S.map((p) => p.word), S.map((p) => p.qwen))}`);

type Rule = [string, (p: P) => boolean];
const L = REPLACE_MAX_OVERLAP;
const NAMED: Rule[] = [
  ["shipped: line<=.15 AND word<=.50", (p) => p.flagged],
  ["word<=.50 alone (thread 8)", (p) => p.word <= 0.5],
  ["qwen<=.80 alone", (p) => p.qwen <= 0.8],
  ["shipped, vetoed when qwen>.90", (p) => p.flagged && p.qwen <= 0.9],
  ["shipped OR qwen<=.70", (p) => p.flagged || p.qwen <= 0.7],
  ["word<=.50 OR qwen<=.70", (p) => p.word <= 0.5 || p.qwen <= 0.7],
  ["word<=.60 AND qwen<=.85", (p) => p.word <= 0.6 && p.qwen <= 0.85],
  ["word<=.70 AND qwen<=.80", (p) => p.word <= 0.7 && p.qwen <= 0.8],
];
const half = (h: number) => <T,>(xs: T[]) => xs.filter((_, i) => i % 2 === h);
const line = (name: string, f: (p: P) => boolean, e: P[], sb: P[], un: P[]) =>
  `    ${name.padEnd(36)} edits flagged ${String(count(e, f)).padStart(4)} (${pc(count(e, f), e.length).padStart(5)}%, ${count(e, (p) => f(p) && cosmetic(p))} cosmetic)   siblings missed ${pc(count(sb, (p) => !f(p)), sb.length).padStart(5)}%   unrelated missed ${pc(count(un, (p) => !f(p)), un.length).padStart(4)}%`;

console.log("\n=== 3. whole rules, on two disjoint halves of the pairs ===");
for (const h of [0, 1]) {
  const e = half(h)(E), sb = half(h)(S), un = half(h)(U);
  console.log(`\n  half ${h + 1}: ${e.length} real edits, ${sb.length} sibling swaps, ${un.length} unrelated swaps`);
  for (const [name, f] of NAMED) console.log(line(name, f, e, sb, un));
}

// Every rule of the form [line<=.15 AND] word<=w (AND|OR) qwen<=q, on a grid.
// Keep those no other rule beats on BOTH flagged edits and missed siblings in
// half 1, then show what each does on half 2, which it never saw.
console.log("\n=== 4. rule search: chosen on half 1, reported on half 2 ===");
const grid: Rule[] = [];
const WS = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8], QS = [0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
for (const useLine of [false, true]) {
  const pre = useLine ? "line<=.15 AND " : "";
  const gate = (p: P) => !useLine || p.line <= L;
  for (const w of WS) grid.push([`${pre}word<=${w.toFixed(2)}`, (p) => gate(p) && p.word <= w]);
  for (const q of QS) grid.push([`${pre}qwen<=${q.toFixed(2)}`, (p) => gate(p) && p.qwen <= q]);
  for (const w of WS) for (const q of QS) {
    grid.push([`${pre}word<=${w.toFixed(2)} AND qwen<=${q.toFixed(2)}`, (p) => gate(p) && p.word <= w && p.qwen <= q]);
    grid.push([`${pre}(word<=${w.toFixed(2)} OR qwen<=${q.toFixed(2)})`, (p) => gate(p) && (p.word <= w || p.qwen <= q)]);
  }
}
const e1 = half(0)(E), s1 = half(0)(S), u1 = half(0)(U), e2 = half(1)(E), s2 = half(1)(S), u2 = half(1)(U);
const pts = grid.map(([name, f]) => ({ name, f, flags: count(e1, f), miss: count(s1, (p) => !f(p)), usesQwen: name.includes("qwen") }));
const front = (xs: typeof pts) => xs
  .filter((a) => !xs.some((b) => (b.flags <= a.flags && b.miss < a.miss) || (b.flags < a.flags && b.miss <= a.miss)))
  .filter((a, i, all) => all.findIndex((b) => b.flags === a.flags && b.miss === a.miss) === i)
  .sort((a, b) => a.flags - b.flags);
for (const [title, pool] of [["WITHOUT the embedding (line and word only)", pts.filter((p) => !p.usesQwen)], ["WITH the embedding allowed", pts]] as const) {
  console.log(`\n  best rules ${title}:`);
  console.log(`    ${"rule".padEnd(44)} half 1: edits flagged / siblings missed      half 2: edits flagged / siblings missed / unrelated missed`);
  for (const p of front(pool)) {
    console.log(`    ${p.name.padEnd(44)} ${pc(p.flags, e1.length).padStart(5)}% / ${pc(p.miss, s1.length).padStart(5)}%` +
      `                          ${pc(count(e2, p.f), e2.length).padStart(5)}% (${count(e2, (x) => p.f(x) && cosmetic(x))} cosmetic) / ${pc(count(s2, (x) => !p.f(x)), s2.length).padStart(5)}% / ${pc(count(u2, (x) => !p.f(x)), u2.length).padStart(4)}%`);
  }
}
