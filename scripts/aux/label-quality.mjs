#!/usr/bin/env node
/**
 * entityLabel quality scan over public/addresses.atlas.json.
 *
 * The gate for the fragment defect (docs/plans/entitylabel-fragment-defect.md)
 * is the FRAGMENT rules: no internal sentence break, no dangling function word,
 * no bare pronoun. Those are the shapes prose-scraping produces, and every path
 * that scrapes prose (the extractor, the Phase 2.6 pool, the 4.5c/4.5d title
 * fills) is gated on isPlausibleName — so a non-zero count means an extraction
 * path got past the predicate.
 *
 * The other rules are reported but NOT a gate: Phase 4.5a CONSTRUCTS labels from
 * ICD params ("spUSDS underlying asset", "Base - <long vault name>") and is
 * deliberately exempt from the prose validator. Those are honest data that
 * isCleanLabel simply declines to render.
 *
 * A rising NULL rate is expected and fine: a null owner falls back cleanly (no
 * owner in the UI, chainlog/Etherscan internally), a clause does not.
 *
 * `RULES` below is a THIRD copy of the predicate, and a copy that disagreed with
 * the real one would make this scan lie about the very thing it gates. So it is
 * not authoritative: `isPlausibleName` is imported, and every label is checked
 * for AGREEMENT between the two. A mismatch prints `[drift]` and fails the run.
 * RULES exists only to say WHICH rule a rejected label tripped.
 *
 * Run: node scripts/aux/label-quality.mjs [--samples N] [--compare <atlas.json>]
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPlausibleName } from "../lib/address-annotate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? dflt : process.argv[i + 1];
};
const SAMPLES = Number(arg("--samples", 15));
const COMPARE = arg("--compare", null);

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
const which = (s) => Object.keys(RULES).filter((r) => RULES[r](s));

function scan(file) {
  const rows = Object.entries(JSON.parse(readFileSync(file, "utf8")).addresses);
  // Per-rule counts OVERLAP — "…into WETH. It" trips sentence-break AND
  // trailing-prose — so the headline counts distinct addresses, not rule hits.
  const hits = new Map(Object.keys(RULES).map((r) => [r, []]));
  const fragmentAddrs = new Set();
  const unrenderable = new Set();
  const drift = [];
  const aliasFails = [];
  let labeled = 0;

  const check = (s) => {
    const broken = which(s);
    if (isPlausibleName(s) !== (broken.length === 0)) drift.push([s, broken]);
    return broken;
  };

  for (const [addr, a] of rows) {
    for (const alias of a.aliases ?? []) {
      const t = String(alias).trim();
      const broken = check(t).filter((r) => FRAGMENT_RULES.includes(r));
      if (broken.length) aliasFails.push([addr, t, broken.join("+")]);
    }
    if (!a.entityLabel) continue;
    labeled++;
    const s = String(a.entityLabel).trim();
    for (const rule of check(s)) {
      hits.get(rule).push([addr, s]);
      (FRAGMENT_RULES.includes(rule) ? fragmentAddrs : unrenderable).add(addr);
    }
  }
  return { rows, labeled, hits, fragmentAddrs, unrenderable, aliasFails, drift };
}

function report(title, r) {
  const { rows, labeled, hits, fragmentAddrs, unrenderable, aliasFails, drift } = r;
  const pct = (n) => `${((n / rows.length) * 100).toFixed(1)}%`;
  console.log(`\n${title} — ${rows.length} addresses`);
  console.log(`  with a label:        ${labeled} (${pct(labeled)})`);
  console.log(`  null:                ${rows.length - labeled} (${pct(rows.length - labeled)})`);
  console.log(`  FRAGMENT-SHAPED:     ${fragmentAddrs.size} addresses   <- gate: 0`);
  console.log(`      by rule (overlapping): ${FRAGMENT_RULES.map((x) => `${x} ${hits.get(x).length}`).join(", ")}`);
  console.log(`  aliases, fragment-shaped: ${aliasFails.length}   <- gate: 0`);
  console.log(`  not renderable (${unrenderable.size} addresses; ICD-constructed, isCleanLabel hides these, not a gate)`);
  console.log(`      by rule (overlapping): ${["too-long", "too-short", "lowercase"].map((x) => `${x} ${hits.get(x).length}`).join(", ")}`);
  for (const rule of FRAGMENT_RULES) {
    for (const [addr, s] of hits.get(rule).slice(0, SAMPLES)) console.log(`  [${rule}] ${addr}  ${JSON.stringify(s)}`);
  }
  for (const [addr, s, rule] of aliasFails.slice(0, SAMPLES)) console.log(`  [alias ${rule}] ${addr}  ${JSON.stringify(s)}`);
  for (const [s, broken] of drift) {
    console.log(`  [drift] isPlausibleName and this script's RULES disagree on ${JSON.stringify(s)} (rules: ${broken.join("+") || "none"})`);
  }
  return fragmentAddrs.size + aliasFails.length + drift.length;
}

const now = scan(path.join(ROOT, "public/addresses.atlas.json"));
const failures = report("entityLabel quality", now);

if (COMPARE) {
  report(`baseline (${COMPARE})`, scan(path.resolve(COMPARE)));
  const label = (f) =>
    new Map(Object.entries(JSON.parse(readFileSync(f, "utf8")).addresses).map(([a, x]) => [a, x.entityLabel ?? null]));
  const [was, is] = [label(path.resolve(COMPARE)), label(path.join(ROOT, "public/addresses.atlas.json"))];
  const changed = [...was].filter(([addr, l]) => l !== (is.get(addr) ?? null));
  console.log(`\n  ${changed.length} labels changed vs baseline`);
  for (const [addr, from] of changed.slice(0, SAMPLES)) {
    console.log(`    ${addr}\n      was ${JSON.stringify(from)}\n      now ${JSON.stringify(is.get(addr) ?? null)}`);
  }
}

console.log();
if (failures > 0) process.exitCode = 1;
