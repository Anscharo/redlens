import type { AtlasNode } from "../types";

const BASE = import.meta.env.BASE_URL;

function buildAndSend(docs: Record<string, AtlasNode>) {
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
    if (!bucket) { bucket = []; byParent.set(key, bucket); }
    bucket.push(node);
  }
  for (const bucket of byParent.values()) bucket.sort((a, b) => a.order - b.order);

  self.postMessage({
    type: "ready",
    docs,
    byParentEntries: Array.from(byParent.entries()),
    docNoToIdEntries: Array.from(docNoToId.entries()),
  });
}

fetch(`${BASE}docs.json`)
  .then((r) => r.json())
  .then(buildAndSend)
  .catch((err) => self.postMessage({ type: "error", message: String(err) }));
