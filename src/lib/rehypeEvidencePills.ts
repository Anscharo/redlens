// Rehype plugin: turns the curated library docs' literal evidence-level tags
// — `[evidence level 1 · censused]`, `[evidence level 2 · source-read ✓
// 2026-07-27]`, etc. (see docs/library/concepts.md's legend paragraph) — into
// small colored pills. Runs post-parse over the hast tree (mirrors
// rehypeEthAddresses.ts's text-splitting + code-span-unwrapping approach) so
// it catches the tag wherever it lands: mid-paragraph text, an italic label
// line, or backtick-wrapped inside a heading/bold run.
//
// One illustrative exception: the legend's own "never a combined [evidence
// level 3 · corroborated / evidence level 4 · unverified]-style range" example
// nests a second tag inside the first match's label — that's deliberately
// malformed prose, not a real tag, so it's left as plain text/code.

import { visit } from "unist-util-visit";
import type { Root, Text, Element, ElementContent } from "hast";

const EVIDENCE_RE = /\[evidence level ([1-4]) · ([^\]]+)\]/g;
const FULL_EVIDENCE_RE = /^\[evidence level ([1-4]) · ([^\]]+)\]$/;

function isNestedTag(label: string): boolean {
  return label.includes("evidence level");
}

function pillElement(level: string, label: string): Element {
  return {
    type: "element",
    tagName: "span",
    properties: { className: ["evidence-pill", `evidence-pill-${level}`] },
    children: [{ type: "text", value: `L${level} · ${label}` }],
  };
}

export function rehypeEvidencePills() {
  return () => (tree: Root) => {
    // Pass 1: a code span (backtick-wrapped tag) whose ENTIRE trimmed text is
    // one evidence tag gets unwrapped into a pill, dropping the code styling.
    const codeReplacements: Array<{ parent: Element; index: number; node: Element }> = [];
    visit(tree, "element", (node: Element, index, parent) => {
      if (index == null || !parent || node.tagName !== "code") return;
      if (node.children.length !== 1 || node.children[0].type !== "text") return;
      const m = FULL_EVIDENCE_RE.exec(node.children[0].value.trim());
      if (!m || isNestedTag(m[2])) return;
      codeReplacements.push({ parent: parent as Element, index, node: pillElement(m[1], m[2]) });
    });
    for (const { parent, index, node } of codeReplacements.reverse()) {
      parent.children.splice(index, 1, node);
    }

    // Pass 2: plain-text occurrences (paragraph body, italic label lines,
    // bold unit-opener trailers). Skip text still inside an untouched code
    // span — a partial match there isn't a real tag (see the nested-tag guard).
    const textReplacements: Array<{ parent: Element; index: number; nodes: ElementContent[] }> = [];
    visit(tree, "text", (node: Text, index, parent) => {
      if (index == null || !parent) return;
      if ("tagName" in parent && (parent as Element).tagName === "code") return;
      EVIDENCE_RE.lastIndex = 0;
      if (!EVIDENCE_RE.test(node.value)) return;
      EVIDENCE_RE.lastIndex = 0;

      const parts: ElementContent[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = EVIDENCE_RE.exec(node.value))) {
        if (isNestedTag(m[2])) continue; // leave the malformed combined example as plain text
        if (m.index > last) parts.push({ type: "text", value: node.value.slice(last, m.index) });
        parts.push(pillElement(m[1], m[2]));
        last = m.index + m[0].length;
      }
      if (parts.length === 0) return; // every candidate match was a nested-tag guard hit
      if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
      textReplacements.push({ parent: parent as Element, index, nodes: parts });
    });
    for (const { parent, index, nodes } of textReplacements.reverse()) {
      parent.children.splice(index, 1, ...nodes);
    }
  };
}
