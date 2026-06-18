import type { AtlasNode } from "../types";
import { fetchJson } from "../lib/verify";

// loadAtlas(base) passes a preview's data-source base via the worker `name`
// option (e.g. /api/preview/<sha>/); default is the live atlas under the sha-keyed
// base (/api/atlas/<sha>/). See the note in lib/docs.ts on keeping the
// new Worker(new URL(...)) call inline.
const BASE = self.name || import.meta.env.BASE_URL;

// Build the parent/doc_no lookup maps from whatever node set is passed (shallow on
// the `tree` message, full on `ready`), so the tree can be posted the instant
// docs-shallow.json lands. See docs-split.md.
function buildMaps(docs: Record<string, AtlasNode>) {
  const docNoToId = new Map<string, string>();
  for (const node of Object.values(docs)) {
    docNoToId.set(node.doc_no, node.id);
  }

  function resolveParentId(node: AtlasNode): string | null {
    const dn = node.doc_no;
    if (dn.startsWith("NR-")) return node.parentId;

    const parts = dn.split(".");
    if (parts.length <= 2) return null;

    const last = parts[parts.length - 1];

    if (last.startsWith("var")) {
      return docNoToId.get(parts.slice(0, -1).join(".")) ?? node.parentId;
    }

    if (parts.length >= 4) {
      const m2 = parts[parts.length - 3];
      const m1 = parts[parts.length - 2];
      if (m2 === "0" && (m1 === "3" || m1 === "4" || m1 === "6")) {
        const parentDocNo = parts.slice(0, -3).join(".");
        return docNoToId.get(parentDocNo) ?? node.parentId;
      }
    }

    if (parts.length >= 3 && parts[parts.length - 2] === "1") {
      const candidateParent = parts.slice(0, -2).join(".");
      if (docNoToId.has(candidateParent) && /\.0\.4\.\d+$/.test(candidateParent)) {
        return docNoToId.get(candidateParent)!;
      }
    }

    const parentDocNo = parts.slice(0, -1).join(".");
    return docNoToId.get(parentDocNo) ?? node.parentId;
  }

  const byParent = new Map<string | null, AtlasNode[]>();
  for (const node of Object.values(docs)) {
    const key = resolveParentId(node);
    let bucket = byParent.get(key);
    if (!bucket) {
      bucket = [];
      byParent.set(key, bucket);
    }
    bucket.push(node);
  }
  for (const bucket of byParent.values()) bucket.sort((a, b) => a.order - b.order);

  return {
    byParentEntries: Array.from(byParent.entries()),
    docNoToIdEntries: Array.from(docNoToId.entries()),
  };
}

// Single owner of TWO browser artifacts, split by tree DEPTH (docs/plans/docs-split.md).
// Both hold SELF-CONTAINED full AtlasNodes (id-bearing) — no positional stitching.
//   docs-shallow.json — depth ≤ 5: the entire initial visible tree, content included.
//                       Posted as the `shallow` message the instant it lands → first paint.
//   docs-deep.json    — depth > 5 (~89% of nodes): gated behind "view all
//                       descendants", so loaded after first paint and merged on `ready`.
const shallowP = fetchJson<{ atlasCommit?: string; nodes: AtlasNode[] }>(`${BASE}docs-shallow.json`, "docs-shallow.json");
const deepP = fetchJson<{ atlasCommit?: string; nodes: AtlasNode[] }>(`${BASE}docs-deep.json`, "docs-deep.json");

// Array of nodes → the Record<id, node> the main thread + rest of the app expect.
function toRecord(nodes: AtlasNode[]): Record<string, AtlasNode> {
  const docs: Record<string, AtlasNode> = {};
  for (const n of nodes) docs[n.id] = n;
  return docs;
}

shallowP
  .then((s) => {
    const docs = toRecord(s.nodes);
    self.postMessage({ type: "shallow", docs, atlasCommit: s.atlasCommit ?? null, ...buildMaps(docs) });
  })
  // Swallow a shallow failure here (don't post). Promise.all below sees the same
  // rejection and owns the single "error" post — catching it here too would post
  // a duplicate; omitting the catch entirely would leak an unhandled rejection.
  .catch(() => {});

Promise.all([shallowP, deepP])
  .then(([s, d]) => {
    const docs = toRecord([...s.nodes, ...d.nodes]);
    self.postMessage({ type: "ready", docs, atlasCommit: s.atlasCommit ?? null, ...buildMaps(docs) });
  })
  .catch((err) => self.postMessage({ type: "error", message: String(err) }));
