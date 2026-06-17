import type { AtlasNode } from "../types";
import { fetchJson } from "../lib/verify";

// loadAtlas(base) passes a preview's data-source base via the worker `name`
// option (e.g. /api/preview/<sha>/); default is the live atlas under BASE_URL.
// (name, not a ?base= query param, so the new Worker(new URL(...)) call stays
// inline and Vite compiles the worker — see the note in lib/docs.ts.)
const BASE = self.name || import.meta.env.BASE_URL;

function buildAndSend(docs: Record<string, AtlasNode>, atlasCommit: string | null) {
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

  self.postMessage({
    type: "ready",
    docs,
    atlasCommit,
    byParentEntries: Array.from(byParent.entries()),
    docNoToIdEntries: Array.from(docNoToId.entries()),
  });
}

fetchJson<{ atlasCommit?: string; nodes: Record<string, AtlasNode> }>(`${BASE}docs.json`, "docs.json")
  .then((f) => buildAndSend(f.nodes, f.atlasCommit ?? null))
  .catch((err) => self.postMessage({ type: "error", message: String(err) }));
