#!/usr/bin/env node
/**
 * entityLabel quality scan over public/addresses.atlas.json.
 *
 * The gate for the fragment defect (docs/plans/entitylabel-fragment-defect.md)
 * is the FRAGMENT rules: no internal sentence break, no dangling function word,
 * no bare pronoun. Those are the shapes prose-scraping produces, and every path
 * that scrapes prose (the extractor, the Phase 2.6 pool, the 4.5c/4.5d title
 * fills) is gated on isPlausibleName — so a non-zero count there means an
 * extraction path got past the predicate.
 *
 * The other two rules are reported but NOT a gate: Phase 4.5a CONSTRUCTS labels
 * from ICD params ("spUSDS underlying asset", "Base - <long vault name>") and is
 * deliberately exempt from the prose validator. Those labels are honest data
 * that isCleanLabel simply declines to render.
 *
 * A rising NULL rate is expected and fine: a null owner falls back cleanly (no
 * owner in the UI, chainlog/Etherscan internally), a clause does not.
 *
 * Run: node scripts/aux/label-quality.mjs [--samples N] [--compare <atlas.json>]
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? dflt : process.argv[i + 1];
};
const SAMPLES = Number(arg("--samples", 15));
const COMPARE = arg("--compare", null);

// Same predicates as isPlausibleName, split apart so the report can say WHICH
// rule a label trips — a fragment and an over-long ICD label are not the same
// finding. Keep in sync with scripts/lib/address-annotate.mjs.
const RULES = {
  "sentence-break": (s) => /[.?!]["')\]]?\s/.test(s),
  "trailing-prose": (s) =>
    /\b(it|its|the|this|that|these|those|a|an|and|or|of|to|for|from|into|via|with|through|is|are|be|as|at|by|on|in)$/i.test(s),
  pronoun: (s) => /^(The|This|That|These|Those|It|Its|It['’]s)$/i.test(s),
  "too-long": (s) => s.length > 48,
  "too-short": (s) => s.length < 3,
  lowercase: (s) => /^[a-z]/.test(s),
};
const FRAGMENT_RULES = ["sentence-break", "trailing-prose", "pronoun"];

function scan(file) {
  const rows = Object.entries(JSON.parse(readFileSync(file, "utf8")).addresses);
  const hits = new Map(Object.keys(RULES).map((r) => [r, []]));
  let labeled = 0;
  const aliasFails = [];
  for (const [addr, a] of rows) {
    for (const alias of a.aliases ?? []) {
      const t = String(alias).trim();
      for (const r of FRAGMENT_RULES) if (RULES[r](t)) aliasFails.push([addr, t, r]);
    }
    if (!a.entityLabel) continue;
    labeled++;
    const s = String(a.entityLabel).trim();
    for (const [rule, test] of Object.entries(RULES)) if (test(s)) hits.get(rule).push([addr, s]);
  }
  return { rows, labeled, hits, aliasFails };
}

function report(title, { rows, labeled, hits, aliasFails }) {
  const fragments = FRAGMENT_RULES.reduce((n, r) => n + hits.get(r).length, 0);
  console.log(`\n${title} — ${rows.length} addresses`);
  console.log(`  with a label:        ${labeled} (${((labeled / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  null:                ${rows.length - labeled} (${(((rows.length - labeled) / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  FRAGMENT-SHAPED:     ${fragments}   <- gate: 0`);
  for (const r of FRAGMENT_RULES) console.log(`      ${r.padEnd(16)} ${hits.get(r).length}`);
  console.log(`  aliases, fragment-shaped: ${aliasFails.length}   <- gate: 0`);
  console.log(`  not renderable (ICD-constructed; isCleanLabel hides these, not a gate):`);
  for (const r of ["too-long", "too-short", "lowercase"]) console.log(`      ${r.padEnd(16)} ${hits.get(r).length}`);
  for (const r of FRAGMENT_RULES) {
    for (const [addr, s] of hits.get(r).slice(0, SAMPLES)) console.log(`  [${r}] ${addr}  ${JSON.stringify(s)}`);
  }
  for (const [addr, s, r] of aliasFails.slice(0, SAMPLES)) console.log(`  [alias ${r}] ${addr}  ${JSON.stringify(s)}`);
  return fragments + aliasFails.length;
}

const now = scan(path.join(ROOT, "public/addresses.atlas.json"));
const fragments = report("entityLabel quality", now);

if (COMPARE) {
  const was = scan(path.resolve(COMPARE));
  report(`baseline (${COMPARE})`, was);
  const nowLabels = new Map(
    Object.entries(JSON.parse(readFileSync(path.join(ROOT, "public/addresses.atlas.json"), "utf8")).addresses),
  );
  const wasLabels = new Map(Object.entries(JSON.parse(readFileSync(path.resolve(COMPARE), "utf8")).addresses));
  const changed = [];
  for (const [addr, a] of wasLabels) {
    const b = nowLabels.get(addr);
    if ((a.entityLabel ?? null) !== (b?.entityLabel ?? null)) changed.push([addr, a.entityLabel ?? null, b?.entityLabel ?? null]);
  }
  console.log(`\n  ${changed.length} labels changed vs baseline`);
  for (const [addr, from, to] of changed.slice(0, SAMPLES)) {
    console.log(`    ${addr}\n      was ${JSON.stringify(from)}\n      now ${JSON.stringify(to)}`);
  }
}

console.log();
if (fragments > 0) process.exitCode = 1;
