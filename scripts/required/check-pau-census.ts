#!/usr/bin/env bun
/**
 * `pnpm census:pau [--update] [--snapshots <file|url>] [--root <dir>]`: the
 * PAU census, drift detector for the atlas against the Prime agents' PAU
 * contracts.
 *
 * Checks every rate-limit value the atlas states (public/graph.json) against
 * the PAU snapshots (production GET /api/pau unless --snapshots names another
 * source; scripts/lib/pau-census-source.ts) and compares the result with the
 * committed baseline (.github/pau-census-baseline.json). The census is
 * src/lib/pauCensus.ts and the drift rules are src/lib/pauCensusDiff.ts.
 *
 * Warnings (stderr, picked up by atlas-healer.yml's comm against
 * .github/atlas-warnings-baseline.txt) are `[drift] pau-census:` lines: a new
 * disagreement, a lost match, a value the reader cannot read, a deployment
 * gone, or a source that is unreadable, empty or stale. Resolved
 * disagreements are logged, not warned.
 *
 * Always exits 0 with findings, like the other censuses; a missing build
 * artifact throws. `--update` rewrites the baseline, and refuses whenever the
 * source had a problem, so an outage or a stale worker is never accepted.
 * Nothing reads the baseline but this script; regenerate it with
 * `pnpm census:pau --update`. `--root` points at another checkout (tests).
 */
import fs from "node:fs";
import path from "node:path";
import { formatCensus, pauCensus, type PauCensus } from "../../src/lib/pauCensus.ts";
import { diffPauCensus } from "../../src/lib/pauCensusDiff.ts";
import type { SourceEntity } from "../../src/lib/pauPrimeSources.ts";
import { atlasSkew, PRODUCTION_PAU, readSnapshots } from "../lib/pau-census-source.ts";

const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ROOT = path.resolve(flag("--root") ?? path.join(import.meta.dir, "../.."));
const SOURCE = flag("--snapshots") ?? PRODUCTION_PAU;
const BASELINE_PATH = path.join(ROOT, ".github/pau-census-baseline.json");
const update = process.argv.includes("--update");

function readArtifact<T>(rel: string): T {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) throw new Error(`pau-census: ${rel} is missing; run pnpm build:index && pnpm build:graph first`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function readBaseline(): PauCensus | null {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as PauCensus;
  } catch {
    console.log("pau-census: no baseline found; run with --update to create it");
    return null;
  }
}

const entities = readArtifact<{ entities: SourceEntity[] }>("public/graph.json").entities;
const docs = readArtifact<{ nodes: Record<string, { doc_no?: string }> }>("public/docs.json").nodes;
const names = new Map(entities.map((e) => [e.id, e.name]));

const { snaps, problem } = await readSnapshots(SOURCE);
if (problem) console.warn(`[drift] pau-census: ${problem}`);
if (!snaps) {
  console.log("pau-census: census skipped; the baseline is left as it is");
  process.exit(0);
}
const skew = await atlasSkew(SOURCE, ROOT);
if (skew) console.log(skew);

const census = pauCensus(entities, (id) => docs[id]?.doc_no ?? null, snaps);
const baseline = readBaseline();
let drift = 0;
if (baseline) {
  const diff = diffPauCensus(baseline, census, (prime) => names.get(prime) ?? prime);
  for (const line of diff.drift) console.warn(line);
  for (const line of diff.notes) console.log(line);
  drift = diff.drift.length;
}

const counts = Object.entries(census.counts).map(([status, n]) => `${n} ${status}`).join(", ");
console.log(`pau-census: ${Object.keys(census.values).length} values on ${census.deployments.length} deployments: ${counts}; ${drift} drift warning(s)`);

if (update && problem) {
  console.log("pau-census: --update refused while the source has a problem; the baseline is left as it is");
} else if (update) {
  fs.writeFileSync(BASELINE_PATH, formatCensus(census, SOURCE));
  console.log(`pau-census: baseline written → ${path.relative(ROOT, BASELINE_PATH)}`);
}
