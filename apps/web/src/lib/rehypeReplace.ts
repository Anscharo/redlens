// The two replacement passes shared by the crossview rehype plugins
// (rehypeEvidencePills, rehypeDocRefs): turn a whole code span into one node,
// and split plain text around regex matches. Edits are collected during the
// visit and applied last-to-first, so earlier indexes stay valid while the
// tree is mutated.

import { visit } from "unist-util-visit";
import type { Root, Text, Element, ElementContent } from "hast";

type TextParent = Root | Element;

/** A `<code>` whose ENTIRE trimmed text `toNode` accepts is replaced by the
 *  node it returns, dropping the code styling. `null` leaves the span alone. */
export function replaceCodeSpans(tree: Root, toNode: (text: string) => Element | null): void {
  const hits: Array<{ parent: Element; index: number; node: Element }> = [];
  visit(tree, "element", (node: Element, index, parent) => {
    if (index == null || !parent || node.tagName !== "code") return;
    if (node.children.length !== 1 || node.children[0].type !== "text") return;
    const replacement = toNode(node.children[0].value.trim());
    if (replacement) hits.push({ parent: parent as Element, index, node: replacement });
  });
  for (const { parent, index, node } of hits.reverse()) parent.children.splice(index, 1, node);
}

/** Every `re` match in a text node becomes the node `render` returns for it;
 *  `null` leaves that match as plain text. Text under a parent `skipParent`
 *  accepts is not visited. `re` must be global and match at least one char. */
export function replaceTextMatches(
  tree: Root,
  re: RegExp,
  render: (match: RegExpExecArray) => Element | null,
  skipParent: (parent: TextParent) => boolean = () => false,
): void {
  const hits: Array<{ parent: Element; index: number; nodes: ElementContent[] }> = [];
  visit(tree, "text", (node: Text, index, parent) => {
    if (index == null || !parent || skipParent(parent as TextParent)) return;
    const parts: ElementContent[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(node.value))) {
      const replacement = render(m);
      if (!replacement) continue;
      if (m.index > last) parts.push({ type: "text", value: node.value.slice(last, m.index) });
      parts.push(replacement);
      last = m.index + m[0].length;
    }
    if (parts.length === 0) return; // no match, or every match was declined
    if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
    hits.push({ parent: parent as Element, index, nodes: parts });
  });
  for (const { parent, index, nodes } of hits.reverse()) parent.children.splice(index, 1, ...nodes);
}
