// Layout-agnostic preview diffing: normalize both sides to our internal node
// shape, then compare by UUID.
//
// This replaces the path→doc_no mapping the preview used to do. That mapping was
// only ever possible because one file held exactly one document; the atlas has
// now regrouped twice (one monolith → ~11k document.md → ~16 composed files) and
// under the current layout a single changed file covers thousands of documents,
// so no filename can identify a document. Parsing both sides into uuid-keyed
// snapshots sidesteps the question entirely — whatever upstream regroups next,
// scripts/lib/atlas-source.mjs absorbs it and nothing here changes.
//
// The base side is the MERGE BASE, not current main: a branch that is merely
// behind main would otherwise report every doc main moved ahead on as "changed"
// (measured on pull-256: ~390 docs vs the real 53).

import fs from "node:fs";
import path from "node:path";

// .mjs from scripts/lib — the same loader the build pipeline uses, so a preview
// and a real build can never disagree about what a checkout contains.
import { loadAtlasSource } from "../../../scripts/lib/atlas-source.mjs";

export interface SnapshotDoc {
  /** Structurally compatible with identity.ts's SwapNode, so the live atlas's
   *  docMap can be handed straight in as a snapshot with no conversion. */
  id: string;
  doc_no: string;
  title?: string;
  content?: string;
  contentHash?: string;
}

export type Snapshot = Map<string, SnapshotDoc>;

export interface SnapshotDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

/** Parse an extracted atlas checkout (any layout) into a uuid-keyed snapshot. */
export function snapshotFromSrcDir(srcDir: string): Snapshot {
  const { nodes } = loadAtlasSource(srcDir);
  return new Map(
    nodes.map((n: SnapshotDoc) => [
      n.id,
      { id: n.id, doc_no: n.doc_no, title: n.title, content: n.content, contentHash: n.contentHash },
    ]),
  );
}

/** Parse a built docs.json (the preview's own output) into a uuid-keyed snapshot. */
export function snapshotFromDocsJson(outDir: string): Snapshot {
  const nodes = Object.values(
    JSON.parse(fs.readFileSync(path.join(outDir, "docs.json"), "utf8")).nodes,
  ) as SnapshotDoc[];
  return new Map(
    nodes.map((n) => [
      n.id,
      { id: n.id, doc_no: n.doc_no, title: n.title, content: n.content, contentHash: n.contentHash },
    ]),
  );
}

/**
 * The merge-base snapshot for a preview.
 *
 * `live` is the server's in-memory main atlas: when the merge base IS the commit
 * we already serve — the ordinary case for a PR opened against a main we track
 * hourly — that is the exact answer for free, no fetch at all. Only a PR based on
 * some other commit pays for a tarball.
 *
 * `fetchTree` is passed in rather than imported so this shares runBuild's
 * injected tarball fetcher: the token differs per preview (service token vs
 * GitHub-App installation token) and hermetic build tests stub it out.
 */
export async function loadBaseSnapshot(
  mergeBase: string,
  scratchDir: string,
  fetchTree: (sha: string, atlasDir: string) => Promise<{ srcDir: string }>,
  live?: { atlasCommit?: string | null; snapshot: () => Snapshot },
): Promise<Snapshot> {
  if (live?.atlasCommit && live.atlasCommit === mergeBase) return live.snapshot();

  const { srcDir } = await fetchTree(mergeBase, scratchDir);
  try {
    return snapshotFromSrcDir(srcDir);
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

/**
 * Compare two snapshots by document identity.
 *
 * `added` / `changed` split on uuid presence, not on any file status: a document
 * whose number changed is CHANGED (same uuid, new position), and a brand-new
 * uuid at an existing doc number is ADDED even though its file was "modified".
 * `title` and `doc_no` count as changes alongside content so a pure rename or
 * renumber still surfaces a redline.
 */
export function diffSnapshots(base: Snapshot, head: Snapshot): SnapshotDiff {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [id, h] of head) {
    const b = base.get(id);
    if (!b) {
      added.push(id);
      continue;
    }
    // Compare like with like: hashes when BOTH sides have one (the production
    // case — docs.json carries it and loadAtlasSource computes it), else the
    // bodies. Mixing a hash against raw content would report every doc changed.
    const bodyDiffers =
      h.contentHash && b.contentHash
        ? h.contentHash !== b.contentHash
        : (h.content ?? "") !== (b.content ?? "");
    if (bodyDiffers || h.title !== b.title || h.doc_no !== b.doc_no) changed.push(id);
  }
  for (const id of base.keys()) if (!head.has(id)) removed.push(id);

  return { added, changed, removed };
}
