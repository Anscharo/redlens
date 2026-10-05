// Can the identity gate REUSE the vector semantic search already stores for a
// document, or does it need its own?
//
//   bun scripts/aux/identity-search-vector.ts [--embed] [--detail] [--samples]
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
// --embed    fetches the vectors the cache lacks (needs OPENROUTER_API_KEY)
// --detail   adds the score spreads, the combined rules and the group documents
// --samples  prints the real retitles a rule flags, to read and judge by hand

import { planEmbedRows, shippedPolicy } from "../../src/server/retrieval/embed-rows.ts";
import { buildEmbedText } from "../../src/server/retrieval/embed-text.ts";
import { bodyWhollyReplaced, bodyWordsKept, detectIdentitySwaps, lineOverlap, JUDGEABLE_MIN_WORDS, REPLACE_MAX_OVERLAP, SHORT_BODY_MAX_LINES, type SwapNode } from "../../src/server/preview/identity.ts";
import { auc, dot, lineCount, parentOf, prng, quantile, qwenVectors, share, swappable, walkRetitles, wordCount, type HistoryNode } from "./identity-corpus.ts";

const args = process.argv.slice(2);

type Node = HistoryNode;
// `anchors` holds every document whose stored text is NOT simply its own title
// and body: a group anchor, and also a unit of one that carries a breadcrumb or
// key:value form. A document can enter or leave that set between two commits,
// and the two vectors are then texts of different shapes.
interface World { byId: Map<string, Node>; stored: Map<string, string>; anchors: Set<string> }

/** A snapshot as search would see it: every document's node, and the text
 *  stored under its id. The rows are production's own (planEmbedRows), so the
 *  script and the preview build agree on which documents are stored as a group. */
function world(byId: Map<string, Node>): World {
  const { rows } = planEmbedRows([...byId.values()] as any, shippedPolicy());
  return {
    byId,
    stored: new Map(rows.map((r) => [r.id, r.text])),
    anchors: new Set(rows.filter((r) => !r.plain).map((r) => r.id)),
  };
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
let retitleCommits = 0;
let lastWorld: { of: Map<string, Node>; world: World } | null = null;
const latest = walkRetitles((c, beforeNodes, afterNodes, ids) => {
  // Rows are planned over the whole atlas, so only for commits that need it,
  // and the "after" of one such commit is often the "before" of the next.
  const before = lastWorld?.of === beforeNodes ? lastWorld.world : world(beforeNodes);
  const after = world(afterNodes);
  lastWorld = { of: afterNodes, world: after };
  const changed = [...after.byId.keys()].filter((id) => {
    const a = before.byId.get(id), b = after.byId.get(id)!;
    return a && (a.content !== b.content || a.title !== b.title);
  });
  const added = [...after.byId.keys()].filter((id) => !before.byId.has(id));
  const swapNodes = (w: World) => w.byId as Map<string, SwapNode>;
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
});
const live0 = world(latest);
const retitleCount = pairs.length;

// ---- synthetic swaps, from the latest snapshot -------------------------------
const live = live0;
const liveNodes = [...live.byId.values()].filter((n) => wordCount(n.content) >= JUDGEABLE_MIN_WORDS && !live.anchors.has(n.id));
const { pick, rnd } = prng(7);
const byParent = new Map<string, Node[]>();
for (const n of liveNodes) (byParent.get(parentOf(n)) ?? byParent.set(parentOf(n), []).get(parentOf(n))!).push(n);
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

const KINDS = ["body", "search"] as const;
// ---- score ------------------------------------------------------------------
for (const p of pairs) { p.word = bodyWordsKept(p.bodyA, p.bodyB) ?? 0; p.line = lineOverlap(p.bodyA, p.bodyB); }
const vecs = await qwenVectors(pairs.flatMap((p) => [p.bodyA, p.bodyB, p.searchA, p.searchB]), args.includes("--embed"));
for (const p of pairs) { p.body = dot(vecs.get(p.bodyA), vecs.get(p.bodyB)); p.search = dot(vecs.get(p.searchA), vecs.get(p.searchB)); }
const scored = pairs.filter((p) => !Number.isNaN(p.body) && !Number.isNaN(p.search));
if (scored.length < pairs.length) {
  console.log(`\n!! ${pairs.length - scored.length} of ${pairs.length} pairs have no vector and are left out. Run again with --embed to fetch them.`);
}

const DETAIL = args.includes("--detail");
const med = (xs: number[]) => (xs.length ? quantile(xs, 0.5).toFixed(3) : "n/a");
const qs = (xs: number[]) => (xs.length ? [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => quantile(xs, p).toFixed(3)).join("  ") : "n/a");
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
const rule = (w: number) => "-".repeat(w);

const count = (g: Pair["group"]) => scored.filter((p) => p.group === g).length;
console.log(`
QUESTION
  The identity gate looks at a document whose title changed and decides: was
  it EDITED, or was it REPLACED by a different document? Search already stores
  one vector for each document. Can the gate reuse that vector, or does it
  need a second one made from the body alone?

THE PAIRS BEING SCORED        each pair is an old text and a new text
  real retitle     ${String(count("retitle")).padStart(5)}   from the atlas git history: a document that kept
                           its UUID across a commit and changed its title.
                           Most are edits and a few are true replacements,
                           so a good rule flags few, and the right few.
  sibling swap     ${String(count("sibling")).padStart(5)}   made up: a document paired with a different document
                           under the same parent. These are replacements, and
                           the hard kind. A good rule misses FEW of them.
  unrelated swap   ${String(count("unrelated")).padStart(5)}   made up: a document paired with a random other
                           document. Replacements, and the easy kind.

THE SCORE                     from 0 to 1. High means the two texts are alike.
  body vector      made from the body text alone
  search vector    made from what search stores: the title, then the body
  word containment the share of the old body's words still present, in order
  line overlap     the share of the old body's lines still present`);

const answers: string[] = [];
for (const b of ["short", "mid"] as const) {
  // Documents stored as a group are reported apart, under --detail.
  const R = scored.filter((p) => p.group === "retitle" && p.band === b && !p.anchor);
  const S = scored.filter((p) => p.group === "sibling" && p.band === b);
  const U = scored.filter((p) => p.group === "unrelated" && p.band === b);
  const name = b === "short" ? "1 TO 3 LINES" : "4 TO 20 LINES";
  console.log(`\n\n${rule(78)}\nBODIES OF ${name}     ${R.length} real retitles, ${S.length} sibling swaps, ${U.length} unrelated swaps\n${rule(78)}`);

  console.log(`\n  1. TYPICAL SCORE (the median). A useful measure scores real retitles high\n     and swaps low, with a wide gap between them.\n`);
  console.log(`     ${"".padEnd(18)}${"real retitle".padStart(14)}${"sibling swap".padStart(14)}${"unrelated swap".padStart(16)}`);
  for (const [label, k] of [["body vector", "body"], ["search vector", "search"], ["word containment", "word"], ["line overlap", "line"]] as const) {
    console.log(`     ${label.padEnd(18)}${med(R.map((p) => p[k])).padStart(14)}${med(S.map((p) => p[k])).padStart(14)}${med(U.map((p) => p[k])).padStart(16)}`);
  }

  console.log(`\n  2. SEPARATION. Take one real retitle and one sibling swap at random. How\n     often does the real retitle get the higher score? 100% is perfect, 50%\n     is a coin toss.\n`);
  const sep = Object.fromEntries((["body", "search", "word", "line"] as const).map((k) => [k, auc(R.map((p) => p[k]), S.map((p) => p[k]))]));
  for (const [label, k] of [["body vector", "body"], ["search vector", "search"], ["word containment", "word"], ["line overlap", "line"]] as const) {
    console.log(`     ${label.padEnd(18)}${(100 * sep[k]).toFixed(1).padStart(6)}%`);
  }

  console.log(`\n  3. RULES. Each row is one rule the gate could use. Lower is better in\n     both columns, and a rule is only better if it wins both.\n`);
  console.log(`     ${"a pair is called REPLACED when".padEnd(36)}${"real retitles flagged".padEnd(24)}${"sibling swaps missed".padEnd(22)}unrelated missed`);
  console.log(`     ${rule(34).padEnd(36)}${rule(21).padEnd(24)}${rule(20).padEnd(22)}${rule(16)}`);
  const rules: [string, (p: Pair) => boolean][] = [
    ["today's rule (lines AND words)", (p) => p.bodyTest],
    ["word containment <= 0.50", (p) => p.word <= 0.5],
    ["word containment <= 0.70", (p) => p.word <= 0.7],
    ["search vector <= 0.70", (p) => p.search <= 0.7],
    ["search vector <= 0.75", (p) => p.search <= 0.75],
    ["search vector <= 0.80", (p) => p.search <= 0.8],
    // 0.85 and finer steps above it, for a model whose cosines sit higher than Qwen's.
    ...[0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.92, 0.93, 0.94].map((t): [string, (p: Pair) => boolean] => [`search vector <= ${t.toFixed(2)}`, (p) => p.search <= t]),
    ["body vector <= 0.80", (p) => p.body <= 0.8],
    ["body vector <= 0.85", (p) => p.body <= 0.85],
  ];
  const row = (label: string, f: (p: Pair) => boolean) =>
    console.log(`     ${label.padEnd(36)}${share(R.filter(f).length, R.length).padEnd(24)}${pct(S.filter((p) => !f(p)).length, S.length).padEnd(22)}${pct(U.filter((p) => !f(p)).length, U.length)}`);
  for (const [label, f] of rules) row(label, f);

  const gap = sep.body - sep.search;
  answers.push(
    `  Bodies of ${name.toLowerCase()}: the search vector separates ${(100 * sep.search).toFixed(1)}% and the body vector\n` +
    `    ${(100 * sep.body).toFixed(1)}%. ${Math.abs(gap) < 0.02 ? "The difference is too small to matter, so the stored vector can be reused." : "The difference is large enough to matter, so reuse costs accuracy."}\n` +
    `    Best single measure here: ${(Object.entries(sep) as [string, number][]).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${(100 * v).toFixed(1)}%`).join(", ")}.`,
  );

  if (DETAIL) {
    console.log(`\n  DETAIL: spread of each score, at the 5th, 25th, 50th, 75th and 95th percentile`);
    for (const k of ["body", "search", "word", "line"] as const) console.log(`     ${k.padEnd(7)} real retitles ${qs(R.map((p) => p[k]))}   siblings ${qs(S.map((p) => p[k]))}   unrelated ${qs(U.map((p) => p[k]))}`);
    console.log(`\n  DETAIL: how much adding the title moves the score (search minus body), same percentiles`);
    console.log(`     real retitles ${qs(R.map((p) => p.search - p.body))}   siblings ${qs(S.map((p) => p.search - p.body))}`);
    console.log(`\n  DETAIL: rules that combine two measures`);
    const combos: [string, (p: Pair) => boolean][] = [
      ["routed by size (before thread 7)", (p) => (b === "short" ? p.word <= 0.5 : p.line <= REPLACE_MAX_OVERLAP)],
      ["today's rule, unless search > 0.85", (p) => p.bodyTest && p.search <= 0.85],
      ["today's rule, or search <= 0.70", (p) => p.bodyTest || p.search <= 0.7],
      ["today's rule, or search <= 0.80", (p) => p.bodyTest || p.search <= 0.8],
      ["word <= 0.50, or search <= 0.80", (p) => p.word <= 0.5 || p.search <= 0.8],
      ["word <= 0.70 and search <= 0.85", (p) => p.word <= 0.7 && p.search <= 0.85],
    ];
    for (const [label, f] of combos) row(label, f);
    console.log(`\n  DETAIL: if each vector's cut is set to miss the same share of sibling swaps,\n  how many real retitles does each flag?`);
    for (const miss of [0.05, 0.1, 0.2, 0.3]) {
      const cell = KINDS.map((k) => { const t = quantile(S.map((p) => p[k]), 1 - miss); return `${k} <= ${t.toFixed(3)} flags ${share(R.filter((p) => p[k] <= t).length, R.length)}`; });
      console.log(`     missing ${(miss * 100).toFixed(0).padStart(2)}% of siblings:   ${cell.join("   |   ")}`);
    }
  }
}

const R = scored.filter((p) => p.group === "retitle");
const A = R.filter((p) => p.anchor);
console.log(`\n\n${rule(78)}\nANSWER\n${rule(78)}`);
for (const a of answers) console.log(a);
console.log(`
  Left out of the tables above: ${A.length} of the ${retitleCount} real retitles, because search
  stores those documents as a GROUP (the document with its children folded in,
  or under its ancestors' titles). ${live0.anchors.size} of ${live0.byId.size} live documents are stored
  that way. Their vector is not a vector of the document alone, so the gate
  should keep today's rule for them.

  Caution: "real retitles flagged" is not a count of mistakes. Nobody has
  labelled the retitles, and some of them are true replacements. Today's whole
  gate flags ${R.filter((p) => p.gate).length} of the ${R.length}. Run with --samples to read them.`);

if (DETAIL) {
  console.log(`\n  DETAIL: the ${A.length} real retitles stored as a group (5th to 95th percentile)`);
  console.log(`     the stored shape differs between the old and new side in ${A.filter((p) => p.shapeChanged).length} of them`);
  console.log(`     body    ${qs(A.map((p) => p.body))}\n     search  ${qs(A.map((p) => p.search))}`);
}
if (args.includes("--samples")) {
  const show = (p: Pair) => console.log(`\n  "${p.oldTitle}"\n    -> "${p.newTitle}"\n    old body: ${p.bodyA.replace(/\s+/g, " ").slice(0, 260)}\n    new body: ${p.bodyB.replace(/\s+/g, " ").slice(0, 260)}\n    search vector ${p.search.toFixed(3)}, body vector ${p.body.toFixed(3)}, words kept ${p.word.toFixed(3)}; today's gate ${p.gate ? "FLAGS it" : "does not flag it"}; body of ${p.band === "short" ? "1 to 3" : "4 to 20"} lines${p.anchor ? "; stored as a group" : ""}   [commit ${p.note}]`);
  console.log(`\n\n${rule(78)}\nSAMPLES: the 12 real retitles with the lowest search-vector score\n${rule(78)}`);
  [...R].sort((a, b) => a.search - b.search).slice(0, 12).forEach(show);
  console.log(`\n\n${rule(78)}\nSAMPLES: every real retitle of 4 to 20 lines with a search-vector score of 0.95 or less\n${rule(78)}`);
  R.filter((p) => p.band === "mid" && !p.anchor && p.search <= 0.95).sort((a, b) => a.search - b.search).forEach(show);
  console.log(`\n\n${rule(78)}\nSAMPLES: every real retitle that today's whole gate flags\n${rule(78)}`);
  R.filter((p) => p.gate).forEach(show);
}
