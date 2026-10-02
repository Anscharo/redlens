// atlas_preview_get's result: a PR preview's full text of named documents, next
// to the live Atlas's text of the same documents, for reading a proposal in
// full or checking it against how similar live documents are written.
import type { Indexes } from "../../retrieval/indexes.ts";
import type { AtlasNode } from "../../../types.ts";
import type { ToolResult } from "./tools.ts";
import type { ToolOpen } from "../../preview/tool-access.ts";
import { loadPreviewDocs, previewCite, readPreviewDiff, readPreviewPatches, renderPatch, type PreviewDocs } from "../../preview/bundle-read.ts";
import { CITATION_NOTE, PREVIEW_SOURCE_CLASS, previewHeader } from "./tools-preview-common.ts";

export interface PreviewGetArgs {
  ids: string[];
  include_base: boolean;
  include_children: boolean;
}

const PATCH_LINES = 60;

function ancestors(node: AtlasNode, docs: PreviewDocs) {
  const out: { doc_no: string; title: string }[] = [];
  for (let p = node.parentId ? docs.byId.get(node.parentId) : undefined; p && out.length < 12; p = p.parentId ? docs.byId.get(p.parentId) : undefined) {
    out.unshift({ doc_no: p.doc_no, title: p.title });
  }
  return out;
}

function liveBase(ix: Indexes, id: string) {
  const live = ix.docMap.get(id);
  return live ? { source: `live atlas ${(ix.meta.atlasCommit ?? "").slice(0, 7)}`.trim(), doc_no: live.doc_no, title: live.title, content: live.content } : null;
}

function resolveDoc(docs: PreviewDocs, ref: string): AtlasNode | undefined {
  return docs.byId.get(ref.toLowerCase()) ?? docs.byDocNo.get(ref);
}

export function buildPreviewGet(ix: Indexes, open: Extract<ToolOpen, { status: "ready" }>, a: PreviewGetArgs): ToolResult {
  const { sha, meta, id } = open;
  const docs = loadPreviewDocs(sha);
  const diff = readPreviewDiff(sha);
  const added = new Set(diff?.added ?? []);
  const changed = new Set(diff?.changed ?? []);
  const patches = readPreviewPatches(sha);
  const missing: string[] = [];
  const documents = [];
  for (const ref of a.ids.slice(0, 5)) {
    const node = resolveDoc(docs, ref);
    if (!node) {
      missing.push(ref);
      continue;
    }
    const status = added.has(node.id) ? "added" : changed.has(node.id) ? "changed" : "unchanged";
    const parent = node.parentId ? docs.byId.get(node.parentId) : undefined;
    documents.push({
      id: node.id,
      doc_no: node.doc_no,
      title: node.title,
      type: node.type,
      status,
      parent: parent ? { id: parent.id, doc_no: parent.doc_no, title: parent.title, type: parent.type } : null,
      ancestors: ancestors(node, docs),
      content: node.content,
      ...(a.include_base && status !== "added" ? { base: liveBase(ix, node.id) } : {}),
      ...(patches[node.id] ? { patch: renderPatch(patches[node.id], PATCH_LINES) } : {}),
      ...(a.include_children ? { children: (docs.children.get(node.id) ?? []).map((c) => ({ id: c.id, doc_no: c.doc_no, title: c.title, type: c.type })) } : {}),
      cite: previewCite(sha, node.id),
    });
  }
  return {
    source_class: PREVIEW_SOURCE_CLASS,
    preview: previewHeader(meta, id),
    documents,
    ...(missing.length ? { not_found: missing } : {}),
    style_hint:
      "To check conformance, compare against live documents of the same type under the same parent: atlas_filter " +
      "({ type, ancestor_id: <parent's live id or doc_no> }) or atlas_search, then atlas_get on two or three of them.",
    citation_note: CITATION_NOTE,
  };
}
