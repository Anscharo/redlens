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

// Everything one call reads from the bundle once, shared by every document it returns.
interface GetCtx {
  ix: Indexes;
  sha: string;
  args: PreviewGetArgs;
  docs: PreviewDocs;
  added: Set<string>;
  changed: Set<string>;
  patches: ReturnType<typeof readPreviewPatches>;
}

function getCtx(ix: Indexes, sha: string, args: PreviewGetArgs): GetCtx {
  const diff = readPreviewDiff(sha);
  const added = new Set(diff?.added ?? []);
  const changed = new Set(diff?.changed ?? []);
  return { ix, sha, args, docs: loadPreviewDocs(sha), added, changed, patches: readPreviewPatches(sha) };
}

const summary = (n: AtlasNode) => ({ id: n.id, doc_no: n.doc_no, title: n.title, type: n.type });

const statusOf = (c: GetCtx, id: string) => (c.added.has(id) ? "added" : c.changed.has(id) ? "changed" : "unchanged");

function documentOut(c: GetCtx, node: AtlasNode) {
  const status = statusOf(c, node.id);
  const parent = node.parentId ? c.docs.byId.get(node.parentId) : undefined;
  const patch = c.patches[node.id];
  return {
    ...summary(node),
    status,
    parent: parent ? summary(parent) : null,
    ancestors: ancestors(node, c.docs),
    content: node.content,
    ...(c.args.include_base && status !== "added" ? { base: liveBase(c.ix, node.id) } : {}),
    ...(patch ? { patch: renderPatch(patch, PATCH_LINES) } : {}),
    ...(c.args.include_children ? { children: (c.docs.children.get(node.id) ?? []).map(summary) } : {}),
    cite: previewCite(c.sha, node.id),
  };
}

const STYLE_HINT =
  "To check conformance, compare against live documents of the same type under the same parent: atlas_filter " +
  "({ type, ancestor_id: <parent's live id or doc_no> }) or atlas_search, then atlas_get on two or three of them.";

export function buildPreviewGet(ix: Indexes, open: Extract<ToolOpen, { status: "ready" }>, a: PreviewGetArgs): ToolResult {
  const c = getCtx(ix, open.sha, a);
  const refs = a.ids.slice(0, 5).map((ref) => ({ ref, node: resolveDoc(c.docs, ref) }));
  const missing = refs.filter((r) => !r.node).map((r) => r.ref);
  return {
    source_class: PREVIEW_SOURCE_CLASS,
    preview: previewHeader(open.meta, open.id),
    documents: refs.flatMap((r) => (r.node ? [documentOut(c, r.node)] : [])),
    ...(missing.length ? { not_found: missing } : {}),
    style_hint: STYLE_HINT,
    citation_note: CITATION_NOTE,
  };
}
