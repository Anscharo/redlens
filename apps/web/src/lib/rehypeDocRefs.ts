// Rehype plugin: linkifies every atlas document reference in the curated
// crossview markdown into a reader deep-link, displayed "DOC_NO • Truncated
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
//
// The catalog cites the SAME document twice back to back in a couple of
// recurring idioms, which would otherwise linkify BOTH halves into adjacent
// duplicate links:
//   - a uuid/short-pointer code span immediately followed by a slash-decorated
//     doc_no, e.g. "`83edd4e1` /A.1.11" (dozens of sites in concepts.md);
//   - the "**Exemplar** — DOC_NO Title `uuid`" idiom, where the doc's own
//     title is spelled out in plain text between the bare doc_no and its uuid
//     code span, e.g. "A.1.3.2.2 Review Obligation `907407a8-…`".
// Pass 3 collapses any same-target link pair separated by nothing but
// whitespace, an optional "/" or "—", or (trimmed, case-insensitively) the
// target's own title, into one link — dropping the redundant second
// reference and whatever sat between. Handles either order, though only
// [uuid/pointer]-then-[doc_no] is attested in the docs today.

import { visit } from "unist-util-visit";
import type { Root, Text, Element, ElementContent } from "hast";
import type { AtlasNode } from "@/types";
import { atlasHref } from "@/lib/routes";
import { DOC_NO_RE, FULL_UUID_RE, SHORT_UUID_RE, refLabel, refTooltip, type DocRefResolver } from "./docRefResolver";

const LINK_CLASS = "mono text-xs link-accent";

// Every link this plugin emits is registered here so Pass 3 can tell whether
// two adjacent links point at the same document (and what its title is, to
// recognize the "doc_no Title uuid" idiom), regardless of which pass
// (code-span or bare-text) created the link.
const linkTarget = new WeakMap<Element, { id: string; title: string }>();

function linkElement(node: AtlasNode): Element {
  const el: Element = {
    type: "element",
    tagName: "a",
    properties: { href: atlasHref(node.id), title: refTooltip(node), className: [LINK_CLASS] },
    children: [{ type: "text", value: refLabel(node) }],
  };
  linkTarget.set(el, { id: node.id, title: node.title });
  return el;
}

function isSkippedParent(parent: Element): boolean {
  if (parent.tagName === "code" || parent.tagName === "a") return true;
  const cls = (parent.properties?.className as string[] | undefined) ?? [];
  return cls.includes("evidence-pill");
}

// Only whitespace plus an optional single "/" or em dash between two
// same-target links counts as "just prose decoration for the redundant
// reference" — anything else (real words) means these are two separate,
// deliberate citations and must both stay, UNLESS that "real words" text is
// exactly the target's own title restated (the Exemplar idiom).
const SEPARATOR_ONLY_RE = /^\s*[/—]?\s*$/;

// Collapses internal whitespace (a markdown soft line-wrap inside the title
// restatement renders as "\n  ", not the single space in the source title)
// before comparing, so a title split across a wrapped line still matches.
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function isCollapsible(between: string, title: string): boolean {
  if (SEPARATOR_ONLY_RE.test(between)) return true;
  return normalizeWhitespace(between) === normalizeWhitespace(title);
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

    // Pass 3: collapse an adjacent same-target link pair (either order) into
    // one link, dropping the redundant second link and the separator between
    // them — see the module doc comment.
    visit(tree, "element", (container: Element) => {
      for (let i = 0; i < container.children.length - 2; i++) {
        const a = container.children[i];
        const sep = container.children[i + 1];
        const b = container.children[i + 2];
        if (a.type !== "element" || a.tagName !== "a") continue;
        if (b.type !== "element" || b.tagName !== "a") continue;
        if (sep.type !== "text") continue;
        const targetA = linkTarget.get(a);
        const targetB = linkTarget.get(b);
        if (!targetA || targetA.id !== targetB?.id) continue;
        if (!isCollapsible(sep.value, targetA.title)) continue;
        container.children.splice(i + 1, 2); // drop separator + duplicate link
      }
    });
  };
}
