// Parses the ## / ### heading outline directly out of a curated library
// markdown source (docs/library/concepts.md, concepts-audit.md) — ONE pass
// over the raw text, shared by both the heading-id rehype plugin
// (rehypeHeadingIds.ts) and the Concepts TOC (LibraryToc.tsx). Deriving both
// from the same extraction (rather than a second independent slug pass over
// the rendered hast, or a DOM query) guarantees the TOC's hrefs always match
// the ids actually stamped onto the rendered headings.
import { makeSlugger } from "./slug";

export interface LibraryHeading {
  level: 2 | 3;
  text: string;
  slug: string;
}

// ATX headings only (the curated docs are hand-authored in this style
// throughout); h1 (the doc title) and h4+ are out of scope for anchors/TOC.
const HEADING_LINE_RE = /^(#{2,3})(?!#)\s+(.+?)\s*$/gm;

// Strip inline emphasis/code markup so the extracted text matches what
// react-markdown renders as the heading's visible text (and what rehype
// plugins' hastText would see) closely enough for a stable, readable slug —
// exact hast-text parity isn't required since ids come from this pass, not
// from re-deriving text off the rendered tree.
function stripInlineMarkup(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

export function extractHeadings(raw: string): LibraryHeading[] {
  const slugger = makeSlugger();
  const out: LibraryHeading[] = [];
  for (const m of raw.matchAll(HEADING_LINE_RE)) {
    const level = m[1].length as 2 | 3;
    const text = stripInlineMarkup(m[2].trim());
    if (!text) continue;
    out.push({ level, text, slug: slugger(text) });
  }
  return out;
}

/** Count of h2/h3 ATX heading lines in `text` — used to partition a flat
 *  heading list across LibraryMarkdown's `:::census`-split segments. */
export function countHeadings(text: string): number {
  let n = 0;
  for (const _ of text.matchAll(HEADING_LINE_RE)) n++;
  return n;
}

/**
 * Slice a flat, already-deduped heading list (extractHeadings(fullRaw)) into
 * one chunk per segment, given each segment's own raw markdown text in
 * order. LibraryMarkdown renders each `:::census`-split segment with its own
 * <ReactMarkdown>/rehypeHeadingIds instance; handing each instance ONLY the
 * headings that occur in ITS OWN text (rather than a cursor shared mutably
 * across instances) keeps id assignment idempotent under React's
 * development-mode double-invoke of component render — see rehypeHeadingIds.ts.
 */
export function partitionHeadings(headings: LibraryHeading[], segmentTexts: string[]): LibraryHeading[][] {
  let cursor = 0;
  return segmentTexts.map((text) => {
    const count = countHeadings(text);
    const slice = headings.slice(cursor, cursor + count);
    cursor += count;
    return slice;
  });
}
