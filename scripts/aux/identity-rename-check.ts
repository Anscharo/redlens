// Does the rename-in-place rule (identity.ts renameScore) spare renamed
// documents without sparing replaced ones?
//
//   bun scripts/aux/identity-rename-check.ts [--samples]
//
// Scored on the gate's true input — every document in the atlas git history
// that kept its UUID across a commit while its title changed — and on
// synthetic swaps: true siblings (same document-number parent), unrelated
// documents, and COUSINS, the pair the rule cannot tell from a rename by
// construction: the same title under another agent ("Keel Details" holding
// "Obex Details"). No vectors and no network; the gate runs on lines and words.

import path from "node:path";
import { makeAtlasGitSource } from "../lib/atlas-git-source.mjs";
import { cleanContent } from "../lib/atlas-parser.mjs";
import { bodyWhollyReplaced, renameScore, JUDGEABLE_MIN_WORDS, type SwapNode } from "../../src/server/preview/identity.ts";
import { wordCount, prng, quantile } from "./identity-corpus.ts";

const SAMPLES = process.argv.includes("--samples");
const { atlasCommits, loadSnapshot } = makeAtlasGitSource(path.resolve(import.meta.dir, "../../vendor/next-gen-atlas"));
const squash = (t: string | undefined) => (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const nodes = (snap: Map<string, any>) => new Map<string, SwapNode>([...snap].map(([id, e]) => [id, { id, doc_no: e.doc_no, title: e.title, content: cleanContent((e.content ?? "").split("\n")) }]));

interface Pair { group: string; a: SwapNode; b: SwapNode; replaced: boolean; score: number | null; note: string }
const pairs: Pair[] = [];
const add = (group: string, a: SwapNode, b: SwapNode, note = "") => {
  if (!a.content?.trim() || !b.content?.trim() || wordCount(a.content) < JUDGEABLE_MIN_WORDS) return;
  pairs.push({ group, a, b, replaced: bodyWhollyReplaced(a.content, b.content), score: renameScore(a, b), note });
};

let prev: Map<string, SwapNode> | null = null;
for (const c of atlasCommits("origin/main")) {
  const cur = nodes(loadSnapshot(c.hash) as Map<string, any>);
  if (prev) for (const [id, b] of cur) { const a = prev.get(id); if (a && squash(a.title) !== squash(b.title)) add("real retitle", a, b, `${c.hash.slice(0, 7)} ${c.date.slice(0, 10)}`); }
  prev = cur;
}

const live = [...prev!.values()].filter((n) => wordCount(n.content) >= JUDGEABLE_MIN_WORDS);
const { pick, rnd } = prng(7);
const parentOf = (n: SwapNode) => n.doc_no.slice(0, Math.max(0, n.doc_no.lastIndexOf(".")));
const group = <K,>(key: (n: SwapNode) => K) => { const m = new Map<K, SwapNode[]>(); for (const n of live) (m.get(key(n)) ?? m.set(key(n), []).get(key(n))!).push(n); return m; };
const swappable = (o: SwapNode, c: SwapNode) => o.id !== c.id && squash(o.title) !== squash(c.title) && o.content !== c.content;
const byParent = group(parentOf);
// Cousins: titles that differ only in their FIRST word(s) — the agent's name —
// found by grouping on the title with its first word removed.
const tail = (n: SwapNode) => (n.title ?? "").split(/\s+/).slice(1).join(" ").toLowerCase();
const byTail = group(tail);
const shuffled = [...live];
for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
let nSib = 0, nCous = 0, nUnrel = 0;
for (const o of shuffled) {
  const sibs = (byParent.get(parentOf(o)) ?? []).filter((c) => swappable(o, c));
  if (sibs.length && nSib < 3000) { nSib++; add("sibling swap", o, pick(sibs)); }
  const cous = tail(o).split(" ").length >= 1 && tail(o) ? (byTail.get(tail(o)) ?? []).filter((c) => swappable(o, c) && parentOf(c) !== parentOf(o)) : [];
  if (cous.length && nCous < 3000) { nCous++; add("cousin swap", o, pick(cous)); }
  if (nUnrel < 3000) { const c = pick(live); if (swappable(o, c)) { nUnrel++; add("unrelated swap", o, c); } }
}

const share = (n: number, d: number) => (d ? `${n} of ${d} (${((100 * n) / d).toFixed(1)}%)` : "n/a");
console.log(`
WHAT THIS TESTS
  The gate calls a body REPLACED when few of its lines and words survive. A
  renamed entity breaks that: the name fills most of a short body. The new
  rule applies the TITLE's substitution to the old body and asks how much of
  it then survives. A high score means "renamed in place", and the document
  is spared.

  Only pairs the body test calls replaced are counted, because only those can
  be spared. "Spared" is good for a real rename and bad for a swap.
`);
console.log(`  ${"score at or above".padEnd(20)}${"real retitles spared".padEnd(26)}${"sibling swaps spared".padEnd(26)}${"cousin swaps spared".padEnd(26)}unrelated swaps spared`);
const G = ["real retitle", "sibling swap", "cousin swap", "unrelated swap"];
const flagged = (g: string) => pairs.filter((p) => p.group === g && p.replaced);
for (const t of [0.7, 0.8, 0.9, 0.95, 1]) {
  console.log(`  ${t.toFixed(2).padEnd(20)}${G.map((g) => share(flagged(g).filter((p) => p.score !== null && p.score >= t).length, flagged(g).length).padEnd(26)).join("")}`);
}
for (const g of G) {
  const xs = flagged(g).map((p) => p.score).filter((x): x is number => x !== null);
  console.log(`\n  ${g}: ${pairs.filter((p) => p.group === g).length} pairs, ${flagged(g).length} called replaced, ${xs.length} of those have a score` + (xs.length ? `; scores p05 ${quantile(xs, 0.05).toFixed(2)}, p50 ${quantile(xs, 0.5).toFixed(2)}, p95 ${quantile(xs, 0.95).toFixed(2)}` : ""));
}
if (SAMPLES) {
  const show = (p: Pair) => console.log(`\n  score ${p.score!.toFixed(3)}  [${p.note}]\n    "${p.a.title}" -> "${p.b.title}"\n    old: ${p.a.content!.replace(/\s+/g, " ").slice(0, 200)}\n    new: ${p.b.content!.replace(/\s+/g, " ").slice(0, 200)}`);
  console.log(`\n\nREAL RETITLES the body test calls replaced, that have a score — highest first`);
  flagged("real retitle").filter((p) => p.score !== null).sort((x, y) => y.score! - x.score!).forEach(show);
  console.log(`\n\nSIBLING SWAPS with a score of 0.8 or more — first 8`);
  flagged("sibling swap").filter((p) => p.score !== null && p.score >= 0.8).slice(0, 8).forEach(show);
}
