// Rehype plugin: stamps a stable `id` onto every h2/h3 element in a tree,
// consuming slugs from a pre-computed ordered list (see anatomyHeadings.ts)
// rather than re-deriving slugs off the rendered hast text — one extraction
// pass over the raw markdown source is the single source of truth for both
// this plugin and the Concepts TOC, so they can never disagree on a
// heading's id.
//
// The cursor resets at the START of every transform call (not shared across
// calls) so the plugin is idempotent under repeated invocation on the SAME
// tree — required because React's development-mode double-invoke of
// component render functions (StrictMode) can run a given <ReactMarkdown>
// segment's unified pipeline more than once per commit. Callers (see
// AnatomyMarkdown.tsx) must pass EXACTLY the headings that occur in the
// document fed to this particular tree (partitionHeadings slices the flat,
// whole-document list per `:::census`-split segment) — a shared, mutably
// advancing cursor across segments would double-count under that same
// double-invoke and desync every id after the first affected segment.
import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";
import type { AnatomyHeading } from "./anatomyHeadings";

const HEADING_TAGS = new Set(["h2", "h3"]);

export function rehypeHeadingIds(headings: AnatomyHeading[]) {
  return () => (tree: Root) => {
    let cursor = 0;
    visit(tree, "element", (node: Element) => {
      if (!HEADING_TAGS.has(node.tagName)) return;
      const heading = headings[cursor++];
      if (!heading) return;
      node.properties = { ...node.properties, id: heading.slug };
    });
  };
}
