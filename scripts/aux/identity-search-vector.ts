// Can the identity gate REUSE the vector semantic search already stores for a
// document, or does it need its own?
//
//   bun scripts/aux/identity-search-vector.ts [--embed] [--samples]
//
// The gate's embedding result (identity-embedding-vs-word.ts) was measured on
// the raw BODY. Search stores something else: title + link-stripped body for
// most documents, and for a group anchor the folded key:value text of its
// children under a breadcrumb (src/server/retrieval/embed-units.ts). The gate
// runs only after a title change, so a vector that contains the title is a
// different measurement. This scores both on the same pairs.
//
//   body    cos(old body, new body)                    what was measured
//   search  cos(old stored text, new stored text)      what search would hold
//
// NEGATIVES are real, and they are the gate's true input: every document in
// the atlas git history that kept its UUID across a commit while its title
// changed. POSITIVES are synthetic, as everywhere else: a live document's slot
// holding a sibling's, or an unrelated document's, title and body.
//
// --embed fetches the vectors the cache lacks (needs OPENROUTER_API_KEY).

import path from "node:path";
import { makeAtlasGitSource } from "../lib/atlas-git-source.mjs";
import { cleanContent } from "../lib/atlas-parser.mjs";
import { buildUnits, type GroupPolicy } from "../../src/server/retrieval/embed-units.ts";
import { buildEmbedText } from "../../src/server/retrieval/embed-text.ts";
import { config } from "../../src/server/config.ts";
import { bodyWhollyReplaced, bodyWordsKept, detectIdentitySwaps, lineOverlap, JUDGEABLE_MIN_WORDS, REPLACE_MAX_OVERLAP, SHORT_BODY_MAX_LINES, type SwapNode } from "../../src/server/preview/identity.ts";
import { lineCount, wordCount, prng, quantile, qwenVectors, dot } from "./identity-corpus.ts";

const args = process.argv.slice(2);
const ATLAS_REPO = path.resolve(import.meta.dir, "../../vendor/next-gen-atlas");
const POLICY = config.embedGroupPolicy as GroupPolicy;

interface Node { id: string; doc_no: string; title: string; type: string; content: string }
interface World { byId: Map<string, Node>; stored: Map<string, string>; anchors: Set<string> }
// `anchors` holds every document whose stored text is NOT simply its own title
// and body: a group anchor, and also a unit of one that carries a breadcrumb or
// key:value form. A document can enter or leave that set between two commits,
// and the two vectors are then texts of different shapes.

const squash = (t: string | undefined) => (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A snapshot as search would see it: every document's cleaned node, and the
 *  text stored under its id — its unit's text when it anchors a group, its own
 *  title + body otherwise (a folded member keeps a 1:1 vector for attribution). */
function world(snapshot: Map<string, any>): World {
  const nodes: Node[] = [...snapshot].map(([id, e]) => ({
    id, doc_no: e.doc_no, title: e.title, type: e.type, content: cleanContent((e.content ?? "").split("\n")),
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stored = new Map<string, string>();
  const anchors = new Set<string>();
  for (const u of buildUnits(nodes as any, POLICY, {})) stored.set(u.anchorId, u.text);
  for (const n of nodes) {
    if (!stored.has(n.id)) stored.set(n.id, buildEmbedText(n));
    else if (stored.get(n.id) !== buildEmbedText(n)) anchors.add(n.id);
  }
  return { byId, stored, anchors };
}

interface Pair {
  group: "retitle" | "sibling" | "unrelated";
  band: "short" | "mid" | "long";
  anchor: boolean;
  shapeChanged: boolean;
  oldTitle: string; newTitle: string;
  bodyA: string; bodyB: string; searchA: string; searchB: string;
  bodyTest: boolean; // bodyWhollyReplaced, the shipped body test
  gate: boolean; // the whole shipped gate (retitles only)
  note: string;
  body: number; search: number;
  word: number; line: number;
}
const pairs: Pair[] = [];
const band = (t: string): Pair["band"] => { const n = lineCount(t); return n <= SHORT_BODY_MAX_LINES ? "short" : n <= 20 ? "mid" : "long"; };

// ---- real retitles, from the atlas git history ------------------------------
const { atlasCommits, loadSnapshot } = makeAtlasGitSource(ATLAS_REPO);
const commits = atlasCommits("origin/main");
let prevSnap: Map<string, any> | null = null;
let prevWorld: World | null = null;
let retitleCommits = 0;
for (const c of commits) {
  const snap = loadSnapshot(c.hash) as Map<string, any>;
  if (prevSnap) {
    const ids = [...snap.keys()].filter((id) => {
      const p = prevSnap!.get(id);
      return p && squash(p.title) !== squash(snap.get(id).title);
    });
    if (ids.length) {
      // Units are built over the whole atlas, so only for commits that need it.
      const before: World = prevWorld ?? world(prevSnap);
      const after = world(snap);
      const changed = [...after.byId.keys()].filter((id) => {
        const a = before.byId.get(id), b = after.byId.get(id)!;
        return a && (a.content !== b.content || a.title !== b.title);
      });
      const added = [...after.byId.keys()].filter((id) => !before.byId.has(id));
      const swapNodes = (w: World) => w.byId as unknown as Map<string, SwapNode>;
      const { identitySwap } = detectIdentitySwaps({ changed, added, mainById: swapNodes(before), previewById: swapNodes(after) });
      let used = 0;
      for (const id of ids) {
        const a = before.byId.get(id)!, b = after.byId.get(id)!;
        if (!a.content.trim() || !b.content.trim()) continue; // the gate skips a stub on either side
        if (wordCount(a.content) < JUDGEABLE_MIN_WORDS) continue; // …and a body too small to judge
        used++;
        pairs.push({
          group: "retitle", band: band(a.content), anchor: before.anchors.has(id) || after.anchors.has(id),
          shapeChanged: before.anchors.has(id) !== after.anchors.has(id),
          oldTitle: a.title, newTitle: b.title,
          bodyA: a.content, bodyB: b.content, searchA: before.stored.get(id)!, searchB: after.stored.get(id)!,
          bodyTest: bodyWhollyReplaced(a.content, b.content), gate: id in identitySwap,
          note: `${c.hash.slice(0, 7)} ${c.date.slice(0, 10)} ${id.slice(0, 8)}`, body: NaN, search: NaN, word: NaN, line: NaN,
        });
      }
      if (used) retitleCommits++;
      prevWorld = after;
    } else prevWorld = null;
  }
  prevSnap = snap;
}
const live0 = world(prevSnap!);
console.log(`atlas history: ${commits.length} commits, ${pairs.length} judgeable retitles over ${retitleCommits} commits (${pairs.filter((p) => p.anchor).length} stored as a group on either side)`);
console.log(`latest snapshot: ${live0.anchors.size} of ${live0.byId.size} documents are stored as a group`);

// ---- synthetic swaps, from the latest snapshot -------------------------------
const live = live0;
const liveNodes = [...live.byId.values()].filter((n) => wordCount(n.content) >= JUDGEABLE_MIN_WORDS && !live.anchors.has(n.id));
const { pick, rnd } = prng(7);
const parentOf = (n: Node) => n.doc_no.slice(0, Math.max(0, n.doc_no.lastIndexOf(".")));
const byParent = new Map<string, Node[]>();
for (const n of liveNodes) (byParent.get(parentOf(n)) ?? byParent.set(parentOf(n), []).get(parentOf(n))!).push(n);
const swappable = (o: Node, c: Node) => o.id !== c.id && squash(o.title) !== squash(c.title) && o.content !== c.content;
const swap = (group: Pair["group"], o: Node, c: Node) => pairs.push({
  group, band: band(o.content), anchor: false, shapeChanged: false, oldTitle: o.title, newTitle: c.title,
  bodyA: o.content, bodyB: c.content,
  // The slot keeps its place in the tree and takes the other document's title
  // and body — which, for a document that anchors no group, is all search stores.
  searchA: live.stored.get(o.id)!, searchB: buildEmbedText({ title: c.title, content: c.content }),
  bodyTest: bodyWhollyReplaced(o.content, c.content), gate: false, note: `${o.id.slice(0, 8)}>${c.id.slice(0, 8)}`, body: NaN, search: NaN, word: NaN, line: NaN,
});
for (const [name, per, cap] of [["short", 1, 1500], ["mid", 3, 1e9]] as const) {
  const olds = liveNodes.filter((n) => band(n.content) === name);
  // Shuffle, then take each old body once, so no pair repeats.
  for (let i = olds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [olds[i], olds[j]] = [olds[j], olds[i]]; }
  let n = 0;
  for (const o of olds) {
    if (n >= cap) break;
    // A sibling of similar size: a one-line slot holding a table is not the
    // repurposing that is hard to see.
    const sibs = (byParent.get(parentOf(o)) ?? []).filter((c) => swappable(o, c) && (name === "short" || band(c.content) !== "short"));
    if (!sibs.length) continue;
    n++;
    for (let k = 0; k < per && sibs.length; k++) swap("sibling", o, sibs.splice(Math.floor(rnd() * sibs.length), 1)[0]);
    const c = pick(liveNodes);
    if (swappable(o, c)) swap("unrelated", o, c);
  }
}

// ---- score ------------------------------------------------------------------
for (const p of pairs) { p.word = bodyWordsKept(p.bodyA, p.bodyB) ?? 0; p.line = lineOverlap(p.bodyA, p.bodyB); }
const vecs = await qwenVectors(pairs.flatMap((p) => [p.bodyA, p.bodyB, p.searchA, p.searchB]), args.includes("--embed"));
for (const p of pairs) { p.body = dot(vecs.get(p.bodyA), vecs.get(p.bodyB)); p.search = dot(vecs.get(p.searchA), vecs.get(p.searchB)); }
const scored = pairs.filter((p) => !Number.isNaN(p.body) && !Number.isNaN(p.search));
console.log(`${scored.length} of ${pairs.length} pairs have both vectors`);

function auc(pos: number[], neg: number[]) {
  if (!pos.length || !neg.length) return NaN;
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
const qs = (xs: number[]) => (xs.length ? [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => quantile(xs, p).toFixed(3)).join("  ") : "n/a");
const pc = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1).padStart(5)}% (${n}/${d})` : "n/a");
const KINDS = ["body", "search"] as const;

for (const b of ["short", "mid"] as const) {
  // Group anchors are reported apart: their stored text is a folded group, and
  // the synthetic swaps cannot imitate one.
  const R = scored.filter((p) => p.group === "retitle" && p.band === b && !p.anchor);
  const S = scored.filter((p) => p.group === "sibling" && p.band === b);
  const U = scored.filter((p) => p.group === "unrelated" && p.band === b);
  console.log(`\n================ bodies of ${b === "short" ? "1 to 3" : "4 to 20"} lines ================`);
  console.log(`  ${R.length} real retitles, ${S.length} sibling swaps, ${U.length} unrelated swaps`);
  console.log(`\n  cosine, p05 p25 p50 p75 p95`);
  for (const k of KINDS) console.log(`    ${k.padEnd(7)} retitles ${qs(R.map((p) => p[k]))}   siblings ${qs(S.map((p) => p[k]))}   unrelated ${qs(U.map((p) => p[k]))}`);
  console.log(`\n  real retitles ranked above swaps (AUC, 1 = perfect)`);
  for (const k of KINDS) console.log(`    ${k.padEnd(7)} vs siblings ${auc(R.map((p) => p[k]), S.map((p) => p[k])).toFixed(4)}   vs unrelated ${auc(R.map((p) => p[k]), U.map((p) => p[k])).toFixed(4)}`);
  console.log(`\n  one cut: flag when cosine <= t`);
  console.log(`    ${"rule".padEnd(22)} real retitles flagged     sibling swaps missed     unrelated missed`);
  console.log(`    ${"shipped body test".padEnd(22)} ${pc(R.filter((p) => p.bodyTest).length, R.length).padEnd(24)}  ${pc(S.filter((p) => !p.bodyTest).length, S.length).padEnd(23)}  ${pc(U.filter((p) => !p.bodyTest).length, U.length)}`);
  for (const k of KINDS) for (const t of [0.6, 0.65, 0.7, 0.75, 0.8, 0.85]) {
    console.log(`    ${`${k} <= ${t.toFixed(2)}`.padEnd(22)} ${pc(R.filter((p) => p[k] <= t).length, R.length).padEnd(24)}  ${pc(S.filter((p) => p[k] > t).length, S.length).padEnd(23)}  ${pc(U.filter((p) => p[k] > t).length, U.length)}`);
  }
  console.log(`\n  word rules, and rules that ask both`);
  for (const k of ["word", "line"] as const) console.log(`    AUC ${k.padEnd(5)} vs siblings ${auc(R.map((p) => p[k]), S.map((p) => p[k])).toFixed(4)}   vs unrelated ${auc(R.map((p) => p[k]), U.map((p) => p[k])).toFixed(4)}`);
  const combos: [string, (p: Pair) => boolean][] = [
    ["routed by size (before thread 7)", (p) => (b === "short" ? p.word <= 0.5 : p.line <= REPLACE_MAX_OVERLAP)],
    ["word <= 0.50 alone (thread 8)", (p) => p.word <= 0.5],
    ["word <= 0.60 alone", (p) => p.word <= 0.6],
    ["word <= 0.70 alone", (p) => p.word <= 0.7],
    ["word <= 0.50 OR search <= 0.75", (p) => p.word <= 0.5 || p.search <= 0.75],
    ["word <= 0.50 OR search <= 0.80", (p) => p.word <= 0.5 || p.search <= 0.8],
    ["word <= 0.60 AND search <= 0.85", (p) => p.word <= 0.6 && p.search <= 0.85],
    ["word <= 0.70 AND search <= 0.85", (p) => p.word <= 0.7 && p.search <= 0.85],
    ["shipped, vetoed when search > 0.85", (p) => p.bodyTest && p.search <= 0.85],
    ["shipped, vetoed when search > 0.80", (p) => p.bodyTest && p.search <= 0.8],
    ["shipped OR search <= 0.65", (p) => p.bodyTest || p.search <= 0.65],
    ["shipped OR search <= 0.70", (p) => p.bodyTest || p.search <= 0.7],
    ["shipped OR search <= 0.75", (p) => p.bodyTest || p.search <= 0.75],
    ["shipped OR search <= 0.80", (p) => p.bodyTest || p.search <= 0.8],
  ];
  for (const [name, f] of combos) {
    console.log(`    ${name.padEnd(36)} ${pc(R.filter(f).length, R.length).padEnd(24)}  ${pc(S.filter((p) => !f(p)).length, S.length).padEnd(23)}  ${pc(U.filter((p) => !f(p)).length, U.length)}`);
  }
  console.log(`\n  at a matched miss rate on siblings, how many real retitles does each flag?`);
  for (const miss of [0.05, 0.1, 0.2, 0.3]) {
    const row = KINDS.map((k) => { const t = quantile(S.map((p) => p[k]), 1 - miss); return `${k} <= ${t.toFixed(3)} flags ${pc(R.filter((p) => p[k] <= t).length, R.length)}`; });
    console.log(`    siblings missed ${(miss * 100).toFixed(0).padStart(2)}%:   ${row.join("    |    ")}`);
  }
  console.log(`\n  how much the title moves the score: search minus body, p05 p25 p50 p75 p95`);
  console.log(`    retitles ${qs(R.map((p) => p.search - p.body))}   siblings ${qs(S.map((p) => p.search - p.body))}`);
}

const A = scored.filter((p) => p.group === "retitle" && p.anchor);
console.log(`\n================ real retitles stored as a group on either side (${A.length}) ================`);
console.log(`  the stored text is a folded group or carries a breadcrumb, so it is not the document alone`);
console.log(`  shape differs between the two sides in ${A.filter((p) => p.shapeChanged).length} of them`);
console.log(`    body    ${qs(A.map((p) => p.body))}\n    search  ${qs(A.map((p) => p.search))}`);

const R = scored.filter((p) => p.group === "retitle");
console.log(`\n================ the whole shipped gate, on real history ================`);
console.log(`  of ${R.length} real retitles: body test says replaced ${R.filter((p) => p.bodyTest).length}, whole gate flags ${R.filter((p) => p.gate).length}`);
if (args.includes("--samples")) {
  const show = (p: Pair) => console.log(`  body=${p.body.toFixed(3)} search=${p.search.toFixed(3)} bodyTest=${p.bodyTest} gate=${p.gate} ${p.band}${p.anchor ? " anchor" : ""}  [${p.note}]\n    "${p.oldTitle}" -> "${p.newTitle}"\n    old: ${p.bodyA.replace(/\s+/g, " ").slice(0, 150)}\n    new: ${p.bodyB.replace(/\s+/g, " ").slice(0, 150)}`);
  console.log(`\nreal retitles with the LOWEST search cosine:`);
  [...R].sort((a, b) => a.search - b.search).slice(0, 12).forEach(show);
  console.log(`\nreal retitles the whole shipped gate flags:`);
  R.filter((p) => p.gate).slice(0, 12).forEach(show);
}
