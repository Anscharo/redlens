// Intra-era split / merge lineage for the HTML era (plan §4.1, prototype B). The seed
// pass (seedFromMd) already records extracted_from / merged_into across the #117 seam;
// this generalises it to EVERY HTML hop, so the frozen artifact's docMeta carries the
// regranulation lineage that happens mid-era too (params carved out of a parent doc, a
// retired doc absorbed into a successor).
//
// Pure (no IO/git). Call it AFTER threadBackward has assigned node.uuid everywhere — it
// reads those uuids off the same node objects. For each hop it asks matchNodes for the
// births (newerUnmatched) and deaths (olderUnmatched), then probes with findContainer:
//   • split  — a BORN doc's prose is contained, in order, in a single LARGER older parent
//              that persists → extracted_from(child → parent).
//   • merge  — a DIED doc's prose is contained in a single larger newer successor
//              → merged_into(gone → successor).
// Gated to DIFFERENT-title pairs: a same-title container is almost always a continuation
// the matcher missed (a false birth/death), NOT a lineage event — those are a separate
// matcher-recall concern, so we don't mislabel them as splits/merges here.

import { matchNodes } from "./history-identity.mjs";
import { findContainer } from "./ordered-containment.mjs";

const ntitle = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

export function detectLineage(commits, { sameSectionOnly = true, recover = false, opts = {} } = {}) {
  const extractedFrom = new Map(); // childUuid -> parentUuid
  const mergedInto = new Map();    // goneUuid  -> successorUuid
  const splits = [], merges = [];
  const pool = (node, nodes) => (sameSectionOnly ? nodes.filter((p) => p.section === node.section) : nodes);
  const distinct = (a, b) => a && b && a.uuid && b.uuid && a.uuid !== b.uuid && ntitle(a.title) !== ntitle(b.title);

  for (let i = 1; i < commits.length; i++) {
    const older = commits[i - 1].nodes, newer = commits[i].nodes;
    // mirror the thread's recovery setting so we only probe TRUE births/deaths (not the
    // bulk-rename continuations tier 3.5 now pairs).
    const { olderUnmatched, newerUnmatched } = matchNodes(older, newer, { recoverByContent: recover });
    for (const child of newerUnmatched) {
      const parent = findContainer(child.content, pool(child, older), opts);
      if (parent && parent !== child && distinct(child, parent) && !extractedFrom.has(child.uuid)) {
        extractedFrom.set(child.uuid, parent.uuid);
        splits.push({ sha: commits[i].sha, childUuid: child.uuid, parentUuid: parent.uuid, child: child.title, parent: parent.title });
      }
    }
    for (const gone of olderUnmatched) {
      const succ = findContainer(gone.content, pool(gone, newer), opts);
      if (succ && succ !== gone && distinct(gone, succ) && !mergedInto.has(gone.uuid)) {
        mergedInto.set(gone.uuid, succ.uuid);
        merges.push({ sha: commits[i].sha, goneUuid: gone.uuid, successorUuid: succ.uuid, gone: gone.title, successor: succ.title });
      }
    }
  }
  return { extractedFrom, mergedInto, splits, merges };
}
