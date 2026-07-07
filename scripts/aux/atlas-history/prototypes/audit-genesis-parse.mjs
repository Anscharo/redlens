// Gate 1: reconcile the genesis "≈1,068 dfn rows" claim vs 890 parsed nodes.
// Classify every <dfn> occurrence the parser does NOT emit as a node.
import fs from "node:fs";
import { parseHtmlToNodes } from "/Users/m7/lens/scripts/htmlhist/atlas-html.mjs";

const GENESIS = "/Users/m7/lens/scripts/aux/atlas-history/recovered/genesis-2024-09-02.html";
const html = fs.readFileSync(GENESIS, "utf8");
const textOf = (h) => h.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

const nodes = parseHtmlToNodes(html);
console.log("parsed nodes:", nodes.length);

// every <dfn ...> occurrence
const allDfn = [...html.matchAll(/<dfn(\s[^>]*)?>([\s\S]*?)<\/dfn>/g)];
console.log("total <dfn> occurrences:", allDfn.length);

// the parser's row-start matches
const START = /<tr>\s*<td>\s*<dfn>([\s\S]*?)<\/dfn>\s*<\/td>/g;
const starts = [...html.matchAll(START)];
console.log("START (row-anchor) matches:", starts.length);
const startDfnIdx = new Set();
for (const s of starts) {
  // index of the dfn within this start match
  const rel = s[0].indexOf("<dfn>");
  startDfnIdx.add(s.index + rel);
}

// h1 section boundaries for labeling
const secs = [...html.matchAll(/<h1>(.*?)<\/h1>/g)].map((m) => ({ name: m[1].trim(), at: m.index }));
const sectionAt = (idx) => { let s = "(before first h1)"; for (const x of secs) { if (x.at < idx) s = x.name; else break; } return s; };

// classify each non-start dfn
const classes = {};
const samples = {};
for (const d of allDfn) {
  if (startDfnIdx.has(d.index)) continue;
  const before = html.slice(Math.max(0, d.index - 120), d.index);
  let cls;
  if (d[1]) cls = "dfn-with-attributes";
  else if (/<tr>\s*<td>\s*$/.test(before)) cls = "first-cell-but-whitespace-or-attr-variant"; // shouldn't happen
  else if (/<td>\s*$/.test(before)) cls = "later-cell-of-row (inside another doc's row body)";
  else if (/<th[^>]*>\s*$/.test(before)) cls = "inside-th (table header)";
  else if (/<(p|li|div|span|em|strong|b|i)[^>]*>\s*$/.test(before)) cls = "inline-in-prose";
  else cls = "other";
  classes[cls] = (classes[cls] || 0) + 1;
  const sec = sectionAt(d.index);
  const key = `${cls} @ ${sec}`;
  if (!samples[key]) samples[key] = [];
  if (samples[key].length < 3) samples[key].push(textOf(d[2]).slice(0, 80));
}
console.log("\nnon-node dfn classification:", JSON.stringify(classes, null, 1));
console.log("\nsamples by class @ section:");
for (const [k, v] of Object.entries(samples)) console.log(`  ${k}:\n    ${v.join("\n    ")}`);

// cross-check: per-section <tr> counts vs node counts (any tr-without-dfn doc rows?)
console.log("\nper-section: <tr> total vs dfn-anchored nodes");
const trAll = [...html.matchAll(/<tr>/g)];
const bySec = {};
for (const t of trAll) { const s = sectionAt(t.index); bySec[s] = (bySec[s] || 0) + 1; }
const nodeBySec = {};
for (const n of nodes) nodeBySec[n.section] = (nodeBySec[n.section] || 0) + 1;
for (const s of Object.keys(bySec)) console.log(`  ${s}: tr=${bySec[s]} nodes=${nodeBySec[s] || 0}`);
