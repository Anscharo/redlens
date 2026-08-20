// Rehype plugin: wraps report-search query matches in <mark class="q-mark">
// AFTER markdown parsing, so highlighted content keeps full NodeContent
// rendering — links stay clickable, tables/KaTeX render — instead of falling
// back to plain text while a query is active. Matching mirrors Highlight.tsx:
// longest needle first, case-insensitive unless the query is strict (cased).
// Runs last in the rehype chain so it can mark text inside link labels too.

import { visit } from "unist-util-visit";
import type { Root, Text, Element, ElementContent } from "hast";
import type { ReportQuery } from "@/lib/reportFilter";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function rehypeHighlightMarks(rq: ReportQuery) {
  const source = [...rq.needles]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|");
  return () => (tree: Root) => {
    if (!source) return;
    const re = new RegExp(source, rq.cased ? "g" : "gi");
    const replacements: Array<{ parent: Element; index: number; nodes: ElementContent[] }> = [];
    visit(tree, "text", (node: Text, index, parent) => {
      if (index == null || !parent) return;
      if ("tagName" in parent && (parent as Element).tagName === "mark") return;
      re.lastIndex = 0;
      if (!re.test(node.value)) return;
      re.lastIndex = 0;
      const parts: ElementContent[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(node.value))) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        if (m.index > last) parts.push({ type: "text", value: node.value.slice(last, m.index) });
        parts.push({
          type: "element",
          tagName: "mark",
          properties: { className: ["q-mark"] },
          children: [{ type: "text", value: m[0] }],
        });
        last = m.index + m[0].length;
      }
      if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
      replacements.push({ parent: parent as Element, index, nodes: parts });
    });
    // Splice bottom-up so earlier recorded indexes stay valid.
    for (const { parent, index, nodes } of replacements.reverse()) {
      parent.children.splice(index, 1, ...nodes);
    }
  };
}
