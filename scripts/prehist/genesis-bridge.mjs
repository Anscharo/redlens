// Shared computation: parse the recovered Atlas v2 genesis snapshot (2024-09-02) and
// bridge it to the repo's real root commit (4e931dfd, 2025-05-28), resolving each
// bridged genesis doc to its ACTUAL uuid — not a heuristic (docNo|title) join against
// the frozen JSON artifact (which silently assumes event order matches node order for
// colliding keys), but the same real backward-threading the html-era pipeline runs
// (scripts/lib/run-thread.mjs), so root's uuids are byte-identical to what
// atlas_history already carries. See docs/plans/pre-git-history.md, "ride-along
// decisions" and Phase A pre-flight Gates 1/2.
//
// Consumed by both build-genesis.mjs (stage 1: emits genesis/severed events) and
// build-mip.mjs (stage 2: reads the `bridge` section build-genesis wrote, so the
// expensive threading only ever runs once).

import fs from "node:fs";
import path from "node:path";
import { parseHtmlToNodes } from "../lib/atlas-html.mjs";
import { matchNodes, uuidv5 } from "../lib/history-identity.mjs";
import { sameDocScore, findContainer } from "../lib/ordered-containment.mjs";
import { threadHtmlEra } from "../lib/run-thread.mjs";

const ROOT = process.cwd();
export const GENESIS_HTML_PATH = path.join(ROOT, "scripts/aux/atlas-history/recovered/genesis-2024-09-02.html");
export const GENESIS_CID = "bafkreih7mbj4npqhxeprzk7sahpqjrajmxursaenzqgxdw5uo7sz554os4";
export const GENESIS_DATE = "2024-09-02";
export const DEFAULT_DECISIONS = path.join(ROOT, "public/history-decisions.json");

const AGENT_DB_RE = /agent scope database/i;

// Corroboration bar for a non-tier-1 bridge pair (Gate 2, gate2-bridge-corroboration.json):
// title-blind ordered-containment agreement, or an exact (normalized) title match.
const CORROB_HI = 0.6;
const normT = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The 2 non-tier-1 pairs that failed the automatic corroboration bar but were
// individually adjudicated real (Gate 2, 2026-07-06) — recorded here so the same
// pairs lock deterministically on every run instead of silently dropping to
// curation. Keyed by (genesis doc_no, genesis title) since that's stable across runs.
//   · "MultiSig Freeze Of SparkLend" (A.1.9): sameDoc=0.509, a light rewrite —
//     titles match exactly, root is the same doc lightly reworded.
//   · "Flagged IPs" (A.5.8): sameDoc=0.25, a short stub whose root sibling is an
//     exact-title, same-slot content replacement (disambiguated by the section's
//     other exactly-matching neighbors).
const ADJUDICATED_LOCKS = new Set(["A.1.9|multisig freeze of sparklend", "A.5.8|flagged ips"]);

// Genesis docs matchNodes left ambiguous (2+ similarly-scored candidates or a score too
// low to auto-pick) but a human confirmed by domain knowledge (2026-07-07): "Stars" was
// SparkLend's v1 collateral-tier term, renamed "Agents" in v2 — same underlying doc, not
// a coincidental same-shape sibling. Keyed by (genesis doc_no, normalized genesis title)
// -> normalized root title, so the pairing is explicit and never silently drifts to a
// different candidate if the root corpus changes.
const CONFIRMED_AMBIGUOUS = new Map([
  ["A.3.2|stars credit line borrow rate risk limits", "agents credit line borrow rate risk limits"],
  ["A.3.2|stars credit line borrow rate", "agents credit line borrow rate"],
  ["A.1.9|spark star", "spark agent"],
]);

// Stress test for the seedHop "contained" bucket (docs/plans/pre-git-history.md,
// Phase A pre-flight measurement): the ORIGINAL classification only checked whether a
// root doc's content sat at >=60% shingle-hit inside SOME genesis doc — it never
// checked whether that genesis doc was the ONLY one it fit inside. A boilerplate
// template ("Element Annotation", repeated 100s of times) trivially "contains" any of
// its own siblings at high coverage — that's not a split, it's just the same
// boilerplate reused. `findContainer` is the corrected test: order-preserving
// containment >=90% (not 60%), against ALL genesis docs (not just the first match
// found), returning null the moment more than one genesis doc qualifies.
const SPLIT_MIN_WORDS = 6;

function isCorroborated(pair) {
  if (pair.tier === 1) return true;
  const key = `${pair.older.doc_no || ""}|${normT(pair.older.title)}`;
  if (ADJUDICATED_LOCKS.has(key)) return true;
  const titleEq = normT(pair.older.title) === normT(pair.newer.title);
  const contentAgrees = sameDocScore(pair.older.content || "", pair.newer.content || "") >= CORROB_HI;
  if (pair.tier === 2 || pair.tier === 2.5) {
    const shortDoc = (pair.older.content || "").split(/\s+/).filter(Boolean).length < 12;
    return contentAgrees || (shortDoc && titleEq);
  }
  return titleEq || contentAgrees; // fuzzy tiers (2.7, 3, 3.5)
}

/** A synthetic v5 uuid for a genesis doc that died before the first git commit —
 *  same version-5 scheme as htmlhist (isSynthetic-compatible), namespaced by the
 *  genesis CID so it's stable across runs and distinct from any html-era synthetic id
 *  (those namespace on a commit sha, never on the genesis CID). */
function genesisTombstoneUuid(node) {
  return uuidv5(`${node.section}|${(node.ancestors || []).join(">")}|${node.title}|${node.contentHash}|genesis:${GENESIS_CID}`);
}

/** Parse genesis, thread real root uuids, bridge the two. Returns everything both
 *  build-genesis.mjs and build-mip.mjs need; the threading (~2-4 min, 79 git-show
 *  calls) only has to run once per invocation of THIS function. */
export function computeGenesisBridge({ genesisHtmlPath = GENESIS_HTML_PATH, decisionsPath } = {}) {
  const resolvedDecisions = decisionsPath !== undefined
    ? decisionsPath
    : (fs.existsSync(DEFAULT_DECISIONS) ? DEFAULT_DECISIONS : null);

  const genesisNodes = parseHtmlToNodes(fs.readFileSync(genesisHtmlPath, "utf8"));
  // Same defaults as `pnpm htmlhist:apply` (recover/diff on, committed decisions applied)
  // — guarantees root's uuids match what's actually shipped in atlas_history.
  const { commits } = threadHtmlEra({ decisionsPath: resolvedDecisions, recover: true, diff: true });
  const rootNodes = commits[0].nodes; // commits[0] = the repo's first commit (4e931dfd)

  const m = matchNodes(genesisNodes, rootNodes, { seedHop: true, recoverByContent: true });

  const locked = []; // { genesisNode, rootNode, tier }
  const bridgedRoot = new Set(); // root nodes with a confident genesis predecessor
  for (const p of m.pairs) {
    if (!isCorroborated(p)) continue; // uncertain non-tier-1 pair: skip, defer to curation
    locked.push({ genesisNode: p.older, rootNode: p.newer, tier: p.tier });
    bridgedRoot.add(p.newer);
  }

  // Human-confirmed ambiguous pairs (CONFIRMED_AMBIGUOUS): matchNodes never proposed
  // these as pairs at all (too uncertain to auto-pick among candidates), so they can't
  // go through the isCorroborated path above — promote them directly.
  let confirmedAmbiguous = 0;
  for (const a of m.ambiguous) {
    const g = a.older;
    const expectedRootTitle = CONFIRMED_AMBIGUOUS.get(`${g.doc_no || ""}|${normT(g.title)}`);
    if (!expectedRootTitle) continue;
    const match = (a.candidates || []).find((c) => normT(c.title) === expectedRootTitle);
    if (!match || bridgedRoot.has(match)) continue; // candidate gone or already claimed elsewhere
    locked.push({ genesisNode: g, rootNode: match, tier: "confirmed-ambiguous" });
    bridgedRoot.add(match);
    confirmedAmbiguous++;
  }

  // Stress-test the seedHop "contained" bucket (split/absorb candidates): the ORIGINAL
  // seedHop check only asked "is >=60% of this root doc's content found somewhere in
  // the older corpus" and took the single best-coverage genesis doc as "the parent" —
  // it never checked whether that parent was the ONLY genesis doc the content fit
  // inside. findContainer redoes the check properly: order-preserving containment
  // >=90%, and returns null (reject) the instant a SECOND genesis doc also qualifies —
  // exactly the boilerplate-template trap (e.g. "Element Annotation", reused verbatim
  // across dozens of unrelated docs) that inflated the original 28.
  let confirmedSplits = 0;
  const splitPool = genesisNodes.filter((n) => (n.content || "").split(/\s+/).filter(Boolean).length >= SPLIT_MIN_WORDS);
  for (const c of m.contained) {
    if (bridgedRoot.has(c.newer)) continue; // already claimed via a pair or CONFIRMED_AMBIGUOUS
    const parent = findContainer(c.newer.content || "", splitPool);
    if (!parent) continue; // ambiguous (found in >1 genesis doc) or no longer found at the stricter bar — leave severed-born
    locked.push({ genesisNode: parent, rootNode: c.newer, tier: "confirmed-split" });
    bridgedRoot.add(c.newer);
    confirmedSplits++;
  }

  // Graveyard: genesis docs with NO candidate at all in root (confirmed dead in the
  // severed era) — not the 16 ambiguous/uncorroborated ones, which stay silent pending
  // curation (no claim either way).
  const tombstones = m.olderUnmatched.map((genesisNode) => ({
    genesisNode,
    docId: genesisTombstoneUuid(genesisNode),
  }));

  // Severed-born: every root node without a confident genesis predecessor — covers
  // m.newerUnmatched, whatever of m.contained didn't pass the stricter stress test,
  // and any pair (or ambiguous candidate) that failed corroboration. The honest
  // default per the plan: if we can't confidently claim a genesis origin, claim an
  // undated interval birth instead of guessing which.
  const severedBorn = rootNodes.filter((n) => !bridgedRoot.has(n));
  const agentDbCount = severedBorn.filter((n) => AGENT_DB_RE.test(n.section)).length;

  return {
    genesisNodes,
    rootNodes,
    locked,
    tombstones,
    severedBorn,
    confirmedAmbiguous,
    confirmedSplits,
    stats: {
      genesisNodes: genesisNodes.length,
      rootNodes: rootNodes.length,
      pairs: m.pairs.length,
      tierCounts: m.pairs.reduce((acc, p) => ((acc[p.tier] = (acc[p.tier] || 0) + 1), acc), {}),
      locked: locked.length,
      confirmedAmbiguous,
      confirmedSplits,
      tombstones: tombstones.length,
      ambiguous: m.ambiguous.length,
      ambiguousStillUnresolved: m.ambiguous.length - confirmedAmbiguous,
      contained: m.contained.length,
      containedStillUnresolved: m.contained.length - confirmedSplits,
      severedBorn: severedBorn.length,
      severedBornAgentDb: agentDbCount,
      severedBornCore: severedBorn.length - agentDbCount,
    },
  };
}
