// Reads a ready preview bundle's artifacts for the chat/MCP preview tools. The
// caller has already opened the bundle through tool-access.ts — nothing here
// checks access, so never call it with a sha that did not come from there.

import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../../types.ts";
import type { DiffLine, WordSegment } from "../../lib/history";
import { previewPaths } from "./cache.ts";
import type { PreviewDiffJson } from "./diff-artifacts.ts";

export interface PreviewDocs {
  byId: Map<string, AtlasNode>;
  byDocNo: Map<string, AtlasNode>;
  children: Map<string, AtlasNode[]>;
}

// docs.json is the whole atlas (~7 MB), so keep only the last couple parsed:
// a review conversation asks about one preview several times in a row.
const DOCS_CACHE_MAX = 2;
const docsCache = new Map<string, PreviewDocs>();

function readJson<T>(sha: string, name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(previewPaths(sha).outDir, name), "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadPreviewDocs(sha: string): PreviewDocs {
  const hit = docsCache.get(sha);
  if (hit) {
    docsCache.delete(sha);
    docsCache.set(sha, hit);
    return hit;
  }
  const nodes = Object.values(readJson<{ nodes: Record<string, AtlasNode> }>(sha, "docs.json")?.nodes ?? {});
  const docs: PreviewDocs = { byId: new Map(), byDocNo: new Map(), children: new Map() };
  for (const n of nodes) {
    docs.byId.set(n.id, n);
    docs.byDocNo.set(n.doc_no, n);
    if (!n.parentId) continue;
    const kids = docs.children.get(n.parentId) ?? [];
    kids.push(n);
    docs.children.set(n.parentId, kids);
  }
  for (const kids of docs.children.values()) kids.sort((a, b) => a.order - b.order);
  docsCache.set(sha, docs);
  if (docsCache.size > DOCS_CACHE_MAX) docsCache.delete(docsCache.keys().next().value!);
  return docs;
}

export const readPreviewDiff = (sha: string): PreviewDiffJson | null => readJson<PreviewDiffJson>(sha, "diff.json");

export const readPreviewPatches = (sha: string): Record<string, DiffLine[]> =>
  readJson<Record<string, DiffLine[]>>(sha, "patches.json") ?? {};

/** A patch as plain text lines a model reads: "+ added", "- removed", "…" for
 *  elided context. An in-line edit is written as the whole old line then the
 *  whole new line: word-level markup splits values ("2,[-504-]{+693+}" reads as
 *  504 → 693 when the value went 2,504 → 2,693), and a model quotes what it reads. */
export function renderPatch(lines: DiffLine[], max: number): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (out.length >= max) {
      out.push(`… (${lines.length - max} more lines)`);
      break;
    }
    if (l[0] === "…") out.push("…");
    else if (l[0] === "~") out.push(`- ${sideOf(l[1], "-")}`, `+ ${sideOf(l[1], "+")}`);
    else if (l[0] !== "=") out.push(`${l[0]} ${l[1]}`);
  }
  return out;
}

/** One side of an in-line edit: the unchanged words plus that side's own. */
function sideOf(segments: WordSegment[], side: "-" | "+"): string {
  return segments.map(([op, t]) => (op === "=" || op === side ? t : "")).join("");
}

/** The reader URL that shows a preview's copy of a document — the citation
 *  form for proposed text (live text keeps `/atlas/<uuid>`). */
export const previewCite = (sha: string, id: string): string => `/preview/${sha}/atlas?id=${id}`;
