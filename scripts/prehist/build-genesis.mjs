#!/usr/bin/env bun
// prehist:genesis — Stage 1 (docs/plans/pre-git-history.md): bridge the recovered
// Atlas v2 genesis snapshot (2024-09-02, IPFS-verified) to the repo's real root commit
// (4e931dfd, 2025-05-28) and emit the pre-git origin story for every doc that traces
// back that far:
//   · genesis-bridged docs        -> "Present at Atlas v2 genesis" (era=genesis)
//   · genesis docs with no bridge -> synthetic tombstone: genesis-added + severed-removed
//   · every other root doc        -> "First appeared in the severed era" (era=severed) —
//     the honest default for anything not confidently bridged (docs/plans/
//     pre-git-history.md, Phase A pre-flight Gates 1/2).
//
// Writes public/history-pre-era.json: { events, bridge }. `events` is upserted into
// atlas_history by build:history (scripts/required/build-history.mjs); `bridge` is
// stage 2's input (prehist:mip) so the expensive genesis<->root threading — this
// script's own cost — never has to run twice.
//
//   bun scripts/prehist/build-genesis.mjs             # write the artifact
//   bun scripts/prehist/build-genesis.mjs --measure   # print stats, write nothing

import fs from "node:fs";
import path from "node:path";
import { computeGenesisBridge, GENESIS_CID, GENESIS_DATE } from "./genesis-bridge.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/history-pre-era.json");
const MEASURE = process.argv.includes("--measure");

const GENESIS_SHA = `genesis:${GENESIS_CID}`;
const GENESIS_SOURCE_URL = `https://ipfs.io/ipfs/${GENESIS_CID}`;
const GENESIS_SEQ = -20000;
const SEVERED_SHA = "severed:2024-09-02..2025-05-28";
const SEVERED_SEQ = -10000;
const SEVERED_WINDOW_TEXT = "between Atlas v2 genesis (2024-09-02) and the first git snapshot (2025-05-28)";
const AGENT_DB_RE = /agent scope database/i;

const t0 = Date.now();
const bridge = computeGenesisBridge({});
console.error(`bridge computed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.error(JSON.stringify(bridge.stats, null, 1));

// The html-era thread has a known property (39% of HTML rows are content-duplicates —
// see syntheticUuid's docstring in history-identity.mjs): several DISTINCT node objects
// can carry the SAME uuid — the identity model collapses true duplicates to one shared
// id. buildEvents already dedupes this per-commit for html-era events; this stage never
// did, so multiple genesis/root nodes sharing a uuid produced multiple IDENTICAL rows
// for the same (doc_id, commit_sha, change_type) key — Postgres rejects that as a
// same-statement ON CONFLICT double-hit. Fix: key everything by docId (a Map, not an
// array), first-seen wins — a snapshot fact ("present at genesis") is true once per
// doc regardless of how many physical duplicate rows produced that identity.
const genesisPresent = new Map(); // docId -> event
const severedEvents = new Map(); // docId -> event
const bridgeByDoc = new Map(); // docId -> bridge row (stage 2 input)

function setGenesisPresent(docId) {
  if (genesisPresent.has(docId)) return;
  genesisPresent.set(docId, {
    docId, commitHash: GENESIS_SHA, commitSeq: GENESIS_SEQ, changeType: "added",
    era: "genesis", date: GENESIS_DATE,
    summary: "Present at Atlas v2 genesis", sourceUrl: GENESIS_SOURCE_URL,
  });
}
function setBridgeRow(docId, node) {
  if (bridgeByDoc.has(docId)) return;
  bridgeByDoc.set(docId, { docId, section: node.section, docNo: node.doc_no, title: node.title, content: node.content });
}

// Genesis-present: every confidently-bridged root uuid (real, or html-era synthetic —
// both are valid uuid-shaped identities the existing history rows already use).
for (const { genesisNode, rootNode } of bridge.locked) {
  setGenesisPresent(rootNode.uuid);
  setBridgeRow(rootNode.uuid, genesisNode);
}

// Severed-born: every root doc without a confident genesis predecessor. Agent Scope
// Database rows get a distinct label — they're Agent-launch operational data, not
// cycle-proposed edits (docs/plans/pre-git-history.md, stage 3 note).
let severedAgentDb = 0, severedCore = 0;
for (const node of bridge.severedBorn) {
  if (severedEvents.has(node.uuid)) continue;
  const agentDb = AGENT_DB_RE.test(node.section);
  if (agentDb) severedAgentDb++; else severedCore++;
  severedEvents.set(node.uuid, {
    docId: node.uuid, commitHash: SEVERED_SHA, commitSeq: SEVERED_SEQ, changeType: "added",
    era: "severed", date: null,
    summary: agentDb
      ? `Added during Agent launch operations (severed era, ${SEVERED_WINDOW_TEXT})`
      : `First appeared ${SEVERED_WINDOW_TEXT}`,
  });
}

// Graveyard: genesis docs confirmed dead before the first git commit. Both events land
// on the same synthetic tombstone uuid — the doc's whole (recoverable) life story.
// (Two genesis docs can only share a tombstone uuid if section+ancestry+title+content
// are ALL identical — true duplicates — so first-seen-wins loses no information.)
const tombstoneRemoved = new Map();
for (const { genesisNode, docId } of bridge.tombstones) {
  setGenesisPresent(docId);
  setBridgeRow(docId, genesisNode);
  if (tombstoneRemoved.has(docId)) continue;
  tombstoneRemoved.set(docId, {
    docId, commitHash: SEVERED_SHA, commitSeq: SEVERED_SEQ, changeType: "removed",
    era: "severed", date: null,
    summary: "No longer present by the first git snapshot — died sometime in the severed era",
  });
}

const events = [...genesisPresent.values(), ...severedEvents.values(), ...tombstoneRemoved.values()];
const bridgeOut = [...bridgeByDoc.values()];

const byType = {};
for (const e of events) byType[e.changeType] = (byType[e.changeType] || 0) + 1;
console.error(`\nevents: ${events.length} ${JSON.stringify(byType)}`);
console.error(`severed-born: ${severedEvents.size} distinct (${severedAgentDb} agent-db, ${severedCore} core; ${bridge.severedBorn.length} raw nodes before dedup)`);
console.error(`bridge rows for prehist:mip: ${bridgeOut.length}`);

if (MEASURE) {
  console.error("\n--measure: artifact NOT written.");
} else {
  const artifact = {
    meta: {
      kind: "pre-era-history", genesisCid: GENESIS_CID, genesisDate: GENESIS_DATE,
      stats: bridge.stats, generatedEvents: events.length,
    },
    events,
    bridge: bridgeOut,
  };
  fs.writeFileSync(OUT, JSON.stringify(artifact));
  console.error(`\nwrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
}
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
