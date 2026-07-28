// Rehype plugin: linkifies every atlas document reference in the curated
// library markdown into a reader deep-link, displayed "DOC_NO • Truncated
// Title" (tooltip carries the untruncated "DOC_NO - Title"). Mirrors
// rehypeEvidencePills.ts's structure — a code-span pass, then a plain-text
// pass — parameterized by a DocRefResolver (see docRefResolver.ts) so the
// resolution logic itself stays independently testable.
//
// Recognizes: full UUIDs and short 8-hex-char pointers in code spans, and
// bare doc_no mentions in plain text. Unresolved references (renumbered atlas,
// unknown short-pointer, ambiguous prefix) are left untouched rather than
// emitting a dead link. Must run AFTER rehypeEvidencePills — pill spans and
// existing links are both skipped so a doc_no inside a pill label, or already
// inside a link/code element, never gets a second/nested link.

import { visit } from "unist-util-visit";
import type { Root, Text, Element, ElementContent } from "hast";
import type { AtlasNode } from "../types";
import { atlasHref } from "./routes";
import { DOC_NO_RE, FULL_UUID_RE, SHORT_UUID_RE, refLabel, refTooltip, type DocRefResolver } from "./docRefResolver";

const LINK_CLASS = "mono text-xs link-accent";

function linkElement(node: AtlasNode): Element {
  return {
    type: "element",
    tagName: "a",
    properties: { href: atlasHref(node.id), title: refTooltip(node), className: [LINK_CLASS] },
    children: [{ type: "text", value: refLabel(node) }],
  };
}

function isSkippedParent(parent: Element): boolean {
  if (parent.tagName === "code" || parent.tagName === "a") return true;
  const cls = (parent.properties?.className as string[] | undefined) ?? [];
  return cls.includes("evidence-pill");
}

export function rehypeDocRefs(resolver: DocRefResolver) {
  return () => (tree: Root) => {
    // Pass 1: a code span (backtick span) whose ENTIRE trimmed text is a full
    // or short-form uuid that resolves becomes a link, dropping code styling.
    const codeReplacements: Array<{ parent: Element; index: number; node: Element }> = [];
    visit(tree, "element", (node: Element, index, parent) => {
      if (index == null || !parent || node.tagName !== "code") return;
      if (node.children.length !== 1 || node.children[0].type !== "text") return;
      const t = node.children[0].value.trim();
      let hit: AtlasNode | undefined;
      if (FULL_UUID_RE.test(t)) hit = resolver.resolveFullUuid(t);
      else if (SHORT_UUID_RE.test(t)) hit = resolver.resolveShortUuid(t);
      if (!hit) return;
      codeReplacements.push({ parent: parent as Element, index, node: linkElement(hit) });
    });
    for (const { parent, index, node } of codeReplacements.reverse()) {
      parent.children.splice(index, 1, node);
    }

    // Pass 2: bare doc_no mentions in plain text (paragraph body, list items,
    // bold/italic runs). Skipped inside code spans, existing links, and
    // evidence pills (see isSkippedParent).
    const textReplacements: Array<{ parent: Element; index: number; nodes: ElementContent[] }> = [];
    visit(tree, "text", (node: Text, index, parent) => {
      if (index == null || !parent || !("tagName" in parent)) return;
      if (isSkippedParent(parent as Element)) return;
      DOC_NO_RE.lastIndex = 0;
      if (!DOC_NO_RE.test(node.value)) return;
      DOC_NO_RE.lastIndex = 0;

      const parts: ElementContent[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = DOC_NO_RE.exec(node.value))) {
        const hit = resolver.resolveDocNo(m[0]);
        if (!hit) continue; // unresolved (renumbered / unknown) — leave as plain text
        if (m.index > last) parts.push({ type: "text", value: node.value.slice(last, m.index) });
        parts.push(linkElement(hit));
        last = m.index + m[0].length;
      }
      if (parts.length === 0) return; // every candidate match was unresolved
      if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
      textReplacements.push({ parent: parent as Element, index, nodes: parts });
    });
    for (const { parent, index, nodes } of textReplacements.reverse()) {
      parent.children.splice(index, 1, ...nodes);
    }
  };
}
