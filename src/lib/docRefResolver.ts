// Pure resolution logic behind rehypeDocRefs.ts (AnatomyMarkdown's doc-reference
// linkifier). Kept separate from the rehype plugin so the maps/regexes/formatting
// are independently unit-testable without a hast tree.
//
// Three reference forms the plugin recognizes, in the order the spec defines them:
//   1. full UUID (36 chars, code span)      — direct docs[] lookup
//   2. short 8-hex-char pointer (code span) — unique-prefix lookup; ambiguous → undefined
//   3. bare doc_no (plain text)             — bundle.docNoToId lookup
// Doc_nos always root at "A" (scopes) or "NR-<n>" (Needed Research) — verified
// against the live public/docs.json (10,774 nodes, prefixes exactly {"A", "NR"}).
import type { AtlasNode } from "../types";
import type { AtlasBundle } from "./docsTypes";

export const FULL_UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const SHORT_UUID_RE = /^[0-9a-f]{8}$/i;

// Word-boundary anchored so a trailing "." "," ")" ";" never gets swallowed —
// each segment after the first requires an explicit "." + digits (or "var" +
// digits for Scenario Variations), so the match simply stops at punctuation
// instead of consuming it. NR-<n> is the sibling global-numbering form.
export const DOC_NO_RE = /\b(?:A(?:\.(?:\d+|var\d+))+|NR-\d+)\b/g;

const MAX_TITLE_CHARS = 38;

export function truncateTitle(title: string): string {
  return title.length <= MAX_TITLE_CHARS ? title : `${title.slice(0, MAX_TITLE_CHARS - 1)}…`;
}

/** "DOC_NO • Truncated Title" — the inline link text. */
export function refLabel(node: AtlasNode): string {
  return `${node.doc_no} • ${truncateTitle(node.title)}`;
}

/** "DOC_NO - Full Title" — the `title` tooltip attribute (untruncated). */
export function refTooltip(node: AtlasNode): string {
  return `${node.doc_no} - ${node.title}`;
}

export interface DocRefResolver {
  resolveFullUuid(uuid: string): AtlasNode | undefined;
  resolveShortUuid(prefix8: string): AtlasNode | undefined;
  resolveDocNo(docNo: string): AtlasNode | undefined;
}

const AMBIGUOUS = Symbol("ambiguous-short-uuid-prefix");

function buildShortIndex(docs: Record<string, AtlasNode>): Map<string, AtlasNode | typeof AMBIGUOUS> {
  const idx = new Map<string, AtlasNode | typeof AMBIGUOUS>();
  for (const id in docs) {
    const key = id.slice(0, 8).toLowerCase();
    idx.set(key, idx.has(key) ? AMBIGUOUS : docs[id]);
  }
  return idx;
}

export function buildDocRefResolver(bundle: AtlasBundle): DocRefResolver {
  const shortIndex = buildShortIndex(bundle.docs);
  return {
    resolveFullUuid: (uuid) => bundle.docs[uuid.toLowerCase()],
    resolveShortUuid: (prefix8) => {
      const hit = shortIndex.get(prefix8.toLowerCase());
      return hit === AMBIGUOUS ? undefined : hit;
    },
    resolveDocNo: (docNo) => {
      const id = bundle.docNoToId.get(docNo);
      return id ? bundle.docs[id] : undefined;
    },
  };
}
