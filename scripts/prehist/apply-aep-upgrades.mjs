#!/usr/bin/env bun
// prehist:aep — curated upgrade pass (docs/plans/pre-git-history.md, "Ordering / storage":
// "A high-confidence match... may upgrade the stage-1 interval birth to a dated birth — via
// the curation queue only, never automatically... it lands as a human-locked decision with
// method='human'"). Reads the small, hand-verified aep-upgrades.json (ONLY Accepted AEPs —
// a rejected AEP proposed no real change, so it never gets matched to a doc) and replaces
// each listed doc's generic "First appeared sometime in the severed era" placeholder with
// a specific, dated, sourced fact: "Present in Atlas Edit Proposal N".
//
// Matching rule (why these are safe to auto-lock despite being "only 2 accepted AEPs" worth
// of curation): every doc here is one the AEP's own "List of Edits" section explicitly lists
// as newly ADDED — never a doc the AEP merely references/links as context — and atlas_history
// independently confirms each one's earliest event is a real "added" (birth), not a modify.
//
// Run LAST, after prehist:genesis + prehist:mip (both would regenerate the generic severed
// event this script replaces). Idempotent: re-running finds-and-replaces by docId, never
// blindly appends, so it's safe after a fresh prehist:genesis + prehist:mip run.
//
//   bun scripts/prehist/apply-aep-upgrades.mjs             # apply, write the artifact
//   bun scripts/prehist/apply-aep-upgrades.mjs --measure   # print what would change, write nothing
//
// Core transform is exported pure (no fs) — see scripts_tests/apply-aep-upgrades.test.ts.

import fs from "node:fs";
import path from "node:path";

const SEVERED_SEQ = -10000; // same reserved block as the generic severed marker it replaces

/** Pure transform: given the curated upgrades list + the current pre-era artifact,
 *  return the new events array, the accumulated supersedes list, and stats. Throws
 *  if `upgrades` contains a non-Accepted entry — a rejected AEP proposed no real
 *  change and must never be matched to a doc. */
export function applyAepUpgrades(upgrades, artifact) {
  const rejected = upgrades.filter((u) => u.status !== "Accepted");
  if (rejected.length) {
    throw new Error(`aep-upgrades.json has non-Accepted entries (${rejected.map((u) => u.aep).join(",")}) — a rejected AEP proposed no real change and must never be matched to a doc`);
  }

  const byDocId = new Map(); // docId -> upgrade event
  for (const u of upgrades) {
    for (const d of u.docs) {
      byDocId.set(d.docId, {
        docId: d.docId,
        commitHash: `aep:${u.aep}`,
        commitSeq: SEVERED_SEQ,
        changeType: "added",
        era: "severed",
        date: u.dateRatified,
        summary: `Present in Atlas Edit Proposal ${u.aep}`,
        // Link the AEP file in the git repo (where the actual proposal text lives,
        // pinned to the commit that added it — immutable) rather than the forum
        // thread; forumUrl is kept in aep-upgrades.json as recorded provenance only.
        sourceUrl: u.repoUrl,
        method: "human",
      });
    }
  }

  // Rows this pass supersedes: the artifact-side replace (below) swaps them in the
  // EVENTS array, but the row already upserted into Postgres under the OLD commit_sha
  // won't be touched by a later upsert (different conflict key) — build-history.mjs
  // reads this list to explicitly DELETE the stale DB row, so `prehist:aep` doesn't
  // need a bespoke manual step every time it (re)runs.
  const supersedesThisRun = [];
  let replaced = 0;
  const events = artifact.events.map((e) => {
    const upgrade = byDocId.get(e.docId);
    if (!upgrade || e.changeType !== "added" || e.era !== "severed") return e;
    // Re-running against an already-upgraded artifact must be a true no-op: the event
    // IS the upgrade already (same commitHash), so there's no stale row to supersede.
    // Without this guard, every re-run would append a spurious self-referential
    // supersede entry (recording "aep:1 supersedes aep:1") that grows without bound.
    if (e.commitHash !== upgrade.commitHash) {
      replaced++;
      supersedesThisRun.push({ docId: e.docId, commitHash: e.commitHash, changeType: e.changeType });
    }
    return upgrade;
  });

  let missing = 0;
  for (const docId of byDocId.keys()) {
    if (!artifact.events.some((e) => e.docId === docId && e.changeType === "added" && e.era === "severed")) missing++;
  }

  // Accumulate across runs (idempotent by docId+commitHash+changeType) rather than
  // overwrite — a prior run's supersede record stays valid even if this run's
  // upgrades list no longer touches that doc.
  const priorSupersedes = artifact.supersedes || [];
  const key = (s) => `${s.docId}|${s.commitHash}|${s.changeType}`;
  const merged = new Map(priorSupersedes.map((s) => [key(s), s]));
  for (const s of supersedesThisRun) merged.set(key(s), s);

  return {
    events,
    supersedes: [...merged.values()],
    stats: { docs: byDocId.size, aeps: upgrades.length, replaced, missing },
  };
}

if (import.meta.main) {
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, "public/history-pre-era.json");
  const UPGRADES_PATH = path.join(ROOT, "scripts/prehist/aep-upgrades.json");
  const MEASURE = process.argv.includes("--measure");

  const upgrades = JSON.parse(fs.readFileSync(UPGRADES_PATH, "utf8"));
  const artifact = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const { events, supersedes, stats } = applyAepUpgrades(upgrades, artifact);

  console.error(`upgrades: ${stats.docs} docs across ${stats.aeps} AEP(s); replaced ${stats.replaced} generic severed events`);
  if (stats.missing) console.error(`WARNING: ${stats.missing} upgrade doc(s) had no matching generic severed event to replace — check aep-upgrades.json docIds against a fresh prehist:genesis run`);

  if (MEASURE) {
    console.error("\n--measure: artifact NOT written.");
  } else {
    artifact.events = events;
    artifact.supersedes = supersedes;
    artifact.meta = { ...(artifact.meta || {}), aepUpgrades: { count: stats.docs, aeps: upgrades.map((u) => u.aep) } };
    fs.writeFileSync(OUT, JSON.stringify(artifact));
    console.error(`\nwrote ${path.relative(ROOT, OUT)} (${supersedes.length} superseded row(s) tracked for DB cleanup)`);
  }
}
