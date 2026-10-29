import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Stamps `data-hash` on every inline `code` span holding nothing but a 64-hex
 * value, read back by NodeContentInner's code renderer (RateLimitKey.tsx). Runs
 * after rehypeEthAddresses, which wraps a transaction hash's code span in its
 * explorer link, so a code span inside an `<a>` is skipped. A RateLimitID, a
 * pool ID and any other bytes32 are all written this way; which one a hash is
 * gets decided where it renders, by whether a PAU contract holds it as a key.
 */
export function rehypeHashCodes() {
  return () => (tree: Root) => {
    visit(tree, "element", (node: Element, _index, parent) => {
      if (node.tagName !== "code" || (parent as Element | undefined)?.tagName === "a") return;
      const [child] = node.children;
      if (node.children.length !== 1 || child.type !== "text") return;
      const hash = child.value.trim();
      if (HASH_RE.test(hash)) node.properties = { ...node.properties, "data-hash": hash.toLowerCase() };
    });
  };
}

export const hashCodesPlugin = rehypeHashCodes();
