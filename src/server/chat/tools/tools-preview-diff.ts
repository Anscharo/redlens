// atlas_preview_diff's result: what a PR preview adds, changes and removes,
// relative to the base its redline was computed against (meta.bases.auto).
import type { Indexes } from "../../retrieval/indexes.ts";
import type { AtlasNode } from "../../../types.ts";
import type { ToolResult } from "./tools.ts";
import type { ToolOpen } from "../../preview/tool-access.ts";
import { loadPreviewDocs, previewCite, readPreviewDiff, readPreviewPatches, renderPatch, type PreviewDocs } from "../../preview/bundle-read.ts";
import { CITATION_NOTE, PREVIEW_SOURCE_CLASS, byDocNo, previewHeader } from "./tools-preview-common.ts";
import { previewCaps, type LargeRead } from "../large-read.ts";

export interface PreviewDiffArgs {
  change?: "added" | "changed" | "removed";
  offset: number;
  limit: number;
  patch_lines: number;
}

type Change = "added" | "changed" | "removed";
interface Row {
  change: Change;
  node: Pick<AtlasNode, "id" | "doc_no" | "title" | "type" | "parentId">;
}

function parentOf(node: Row["node"], docs: PreviewDocs, ix: Indexes) {
  if (!node.parentId) return null;
  const p = docs.byId.get(node.parentId) ?? ix.docMap.get(node.parentId);
  return p ? { id: p.id, doc_no: p.doc_no, title: p.title } : { id: node.parentId };
}

function collectRows(ix: Indexes, docs: PreviewDocs, diff: NonNullable<ReturnType<typeof readPreviewDiff>>): Row[] {
  const rows: Row[] = [];
  for (const id of diff.added) {
    const n = docs.byId.get(id);
    if (n) rows.push({ change: "added", node: n });
  }
  for (const id of diff.changed) {
    const n = docs.byId.get(id);
    if (n) rows.push({ change: "changed", node: n });
  }
  for (const id of diff.removed ?? []) {
    const n = ix.docMap.get(id);
    rows.push({ change: "removed", node: n ?? { id, doc_no: "", title: "", type: "", parentId: null } });
  }
  return rows.sort((x, y) => byDocNo(x.node, y.node));
}

/** `read` is the chat turn's large-read state: page sizes above 100 documents and 40 patch lines need one with room left (large-read.ts). */
export function buildPreviewDiff(ix: Indexes, open: Extract<ToolOpen, { status: "ready" }>, args: PreviewDiffArgs, read?: LargeRead | null): ToolResult {
  const caps = previewCaps(read);
  const a = { ...args, limit: Math.min(args.limit, caps.limit), patch_lines: Math.min(args.patch_lines, caps.patchLines) };
  const { sha, meta, id } = open;
  const diff = readPreviewDiff(sha);
  if (!diff) {
    return { source_class: PREVIEW_SOURCE_CLASS, status: "no-diff", preview: previewHeader(meta, id), message: "This preview was built without a diff." };
  }
  const docs = loadPreviewDocs(sha);
  const patches = readPreviewPatches(sha);
  const all = collectRows(ix, docs, diff).filter((r) => !a.change || r.change === a.change);
  const page = all.slice(a.offset, a.offset + a.limit);
  const documents = page.map(({ change, node }) => ({
    change,
    id: node.id,
    doc_no: node.doc_no,
    title: node.title,
    type: node.type,
    parent: parentOf(node, docs, ix),
    ...(diff.renumbered[node.id] ? { renumbered: diff.renumbered[node.id] } : {}),
    ...(diff.retitled[node.id] ? { retitled: diff.retitled[node.id] } : {}),
    ...(diff.reusedSlot[node.id] ? { reused_slot: diff.reusedSlot[node.id] } : {}),
    ...(diff.identitySwap[node.id] ? { identity_swap: diff.identitySwap[node.id] } : {}),
    ...(a.patch_lines > 0 && patches[node.id] ? { patch: renderPatch(patches[node.id], a.patch_lines) } : {}),
    cite: change === "removed" ? `/atlas/${node.id}` : previewCite(sha, node.id),
  }));
  const next = a.offset + page.length;
  return {
    source_class: PREVIEW_SOURCE_CLASS,
    preview: previewHeader(meta, id),
    counts: {
      added: diff.added.length,
      changed: diff.changed.length,
      removed: diff.removed ? diff.removed.length : null,
      renumbered: Object.keys(diff.renumbered).length,
      retitled: Object.keys(diff.retitled).length,
      identity_swaps: Object.keys(diff.identitySwap).length,
    },
    documents,
    has_more: next < all.length,
    ...(next < all.length ? { next_offset: next } : {}),
    ...(diff.removed ? {} : { removed_note: "Removed documents were not recorded for this build." }),
    citation_note: CITATION_NOTE,
  };
}
