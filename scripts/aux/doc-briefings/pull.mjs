import fs from "node:fs";

import { BRIEFING_MAX_FAILURES, countDiffering, isComplete, pullBriefings, serializeArtifact } from "../../lib/doc-briefings.mjs";
import { advanceState, docDigest } from "../../lib/mistakes-sweep.mjs";
import { ARTIFACT, STATE, atLimit, atlasSha, flag, load, readDbRows, readJson, rel } from "./common.mjs";

/** `pnpm briefings:pull`: refresh the artifact and the state from the database. */
export async function pull() {
  if (!process.env.DATABASE_URL) {
    console.error("[briefings] DATABASE_URL is not set — pull reads the briefings from the database");
    process.exit(1);
  }
  const { nodes, nodeMap, state } = load();
  const rows = await readDbRows();
  const pulled = pullBriefings(rows);
  const file = readJson(ARTIFACT, { briefings: {} }).briefings ?? {};
  const sha = atlasSha();

  console.log(`rows pulled: ${Object.keys(pulled).length} (of ${rows.length} in the table)`);
  console.log(`  differ from ${rel(ARTIFACT)}: ${countDiffering(file, pulled)}`);
  console.log(`  at the failure limit (${BRIEFING_MAX_FAILURES}): ${atLimit(rows)}`);

  if (flag("dry-run")) {
    console.log("\n--dry-run: nothing written");
    process.exit(0);
  }

  fs.writeFileSync(ARTIFACT, serializeArtifact(pulled, sha));
  // A row counts as described only when it was written for the live version of
  // its document. A row from an older version stays queued for the next plan.
  const current = Object.entries(pulled)
    .filter(([uuid, row]) => nodeMap[uuid] && row.digest === docDigest(nodeMap[uuid]))
    .map(([uuid]) => uuid);
  const next = advanceState(state, nodeMap, current, [], sha);
  next.complete = state.complete === true || isComplete(nodes, next);
  fs.writeFileSync(STATE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\nwrote ${rel(ARTIFACT)} and ${rel(STATE)} (${current.length} rows current)`);
  process.exit(0);
}
