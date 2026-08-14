#!/usr/bin/env bun
/**
 * Embedding-unit family census. Prints size histograms (no fold/skip decisions)
 * so grouping policies can be chosen from data.
 *
 *   bun scripts/aux/embed-units-census.ts
 *   bun scripts/aux/embed-units-census.ts --json > .cache/embed-units-census.json
 */
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../../src/types.ts";
import { isICD } from "../lib/graph-patterns.mjs";
import { buildChildrenIndex } from "../lib/graph-instances.mjs";
import {
  DIRECTORY_RE,
  HUB_TITLE_RE,
  CHUNK_ROOT_MAX,
  buildUnits,
  foldedIds,
  descendantsOf,
  GROUP_POLICIES,
  type GroupPolicy,
} from "../../src/server/retrieval/embed-units.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const asJson = process.argv.includes("--json");

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

function hist(label: string, sizes: number[]) {
  const s = [...sizes].sort((a, b) => a - b);
  return {
    label,
    n: s.length,
    p50: pct(s, 50),
    p95: pct(s, 95),
    p99: pct(s, 99),
    max: s[s.length - 1] ?? 0,
    mean: s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : 0,
  };
}

const docsFile = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")) as {
  nodes: Record<string, AtlasNode>;
};
const docs = Object.values(docsFile.nodes);
const childrenByDocNo = buildChildrenIndex(docs) as Map<string, AtlasNode[]>;

const icds = docs.filter((d) => isICD(d));
const dirs = docs.filter((d) => DIRECTORY_RE.test((d.content ?? "").trim()));
const hubs = docs.filter((d) => HUB_TITLE_RE.test(d.title));
const paramContainers = docs.filter((d) => /^parameters$/i.test(d.title) || /parameters$/i.test(d.title));

function sizesFor(nodes: AtlasNode[]) {
  const direct: number[] = [];
  const forest: number[] = [];
  for (const n of nodes) {
    direct.push((childrenByDocNo.get(n.doc_no) ?? []).length);
    forest.push(descendantsOf(n.doc_no, childrenByDocNo).length);
  }
  return { direct, forest };
}

const icdS = sizesFor(icds);
const dirS = sizesFor(dirs);
const hubS = sizesFor(hubs);
const paramS = sizesFor(paramContainers);

const families = [
  hist("icd.direct_children", icdS.direct),
  hist("icd.descendant_tree", icdS.forest),
  hist("directory.direct_children", dirS.direct),
  hist("directory.descendant_tree", dirS.forest),
  hist("hub.direct_children", hubS.direct),
  hist("hub.descendant_tree", hubS.forest),
  hist("parameters_title.direct_children", paramS.direct),
  hist("parameters_title.descendant_tree", paramS.forest),
];

const overChunkRoot = dirs.filter((d) => descendantsOf(d.doc_no, childrenByDocNo).length > CHUNK_ROOT_MAX).length;

const policyStats: Record<string, {
  units: number;
  grouped_units: number;
  folded: number;
  grouped_members: ReturnType<typeof hist>;
  grouped_text_chars: ReturnType<typeof hist>;
}> = {};
for (const p of GROUP_POLICIES) {
  const units = buildUnits(docs, p as GroupPolicy);
  const grouped = units.filter((u) => u.memberIds.length > 1);
  const memberSizes = grouped.map((u) => u.memberIds.length);
  const textLens = grouped.map((u) => u.text.length);
  policyStats[p] = {
    units: units.length,
    grouped_units: grouped.length,
    folded: foldedIds(units).size,
    grouped_members: hist("members", memberSizes),
    grouped_text_chars: hist("text", textLens),
  };
}

const examples = {
  icd: icds.slice(0, 3).map((d) => ({
    id: d.id,
    doc_no: d.doc_no,
    title: d.title,
    direct: (childrenByDocNo.get(d.doc_no) ?? []).length,
    descendants: descendantsOf(d.doc_no, childrenByDocNo).length,
  })),
  directory: dirs.slice(0, 3).map((d) => ({
    id: d.id,
    doc_no: d.doc_no,
    title: d.title,
    direct: (childrenByDocNo.get(d.doc_no) ?? []).length,
    descendants: descendantsOf(d.doc_no, childrenByDocNo).length,
  })),
  hub: hubs.slice(0, 3).map((d) => ({
    id: d.id,
    doc_no: d.doc_no,
    title: d.title,
    direct: (childrenByDocNo.get(d.doc_no) ?? []).length,
    descendants: descendantsOf(d.doc_no, childrenByDocNo).length,
  })),
};

const report = {
  docs: docs.length,
  icds: icds.length,
  directories: dirs.length,
  hubs: hubs.length,
  param_title_containers: paramContainers.length,
  directories_over_chunk_root_max: overChunkRoot,
  chunk_root_max: CHUNK_ROOT_MAX,
  families,
  policies: policyStats,
  examples,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`embed-units census — ${docs.length} docs`);
  console.log(`  ICDs ${icds.length} · directories ${dirs.length} · hubs ${hubs.length} · *Parameters titles ${paramContainers.length}`);
  console.log(`  directories with descendant tree > ${CHUNK_ROOT_MAX}: ${overChunkRoot}`);
  console.log("\nfamily size histograms (p50 / p95 / p99 / max):");
  for (const h of families) {
    console.log(`  ${h.label.padEnd(36)} n=${String(h.n).padStart(5)}  p50=${h.p50}  p95=${h.p95}  p99=${h.p99}  max=${h.max}  mean=${h.mean}`);
  }
  console.log("\npolicy dry-run (no API):");
  for (const [p, s] of Object.entries(policyStats) as [string, (typeof policyStats)[string]][]) {
    console.log(
      `  ${p.padEnd(24)} units=${s.units} grouped=${s.grouped_units} folded=${s.folded}` +
        (s.grouped_units ? `  grouped-members p50=${s.grouped_members.p50} p95=${s.grouped_members.p95} max=${s.grouped_members.max}` : ""),
    );
  }
}
