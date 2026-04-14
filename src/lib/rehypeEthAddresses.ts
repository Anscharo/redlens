import { visit } from "unist-util-visit";
import type { Root, Text, Element, ElementContent } from "hast";
import { getAddressMap } from "./addressMap";

const ETH_ADDRESS_RE = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const SOL_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;
const ONCHAIN_RE = new RegExp(`${ETH_ADDRESS_RE.source}|${SOL_ADDRESS_RE.source}`, "g");
const TX_HASH_RE = /Transaction\s+Hash:\s*(0x[0-9a-fA-F]{64})\b/gi;
const TX_HASH_BARE_RE = /^0x[0-9a-fA-F]{64}$/;
const TX_LABEL_RE = /Transaction\s+Hash:\s*$/i;

function splitTextByPattern(
  text: string,
  re: RegExp,
  onMatch: (match: RegExpExecArray) => { linkText: string; url: string },
): ElementContent[] | null {
  re.lastIndex = 0;
  if (!re.test(text)) return null;
  re.lastIndex = 0;

  const parts: ElementContent[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", value: text.slice(last, match.index) });
    }
    const { linkText, url } = onMatch(match);
    const linkStart = text.indexOf(linkText, match.index);
    if (linkStart > match.index + (last === match.index ? 0 : 0)) {
      parts.push({ type: "text", value: text.slice(match.index, linkStart) });
    }
    parts.push({
      type: "element",
      tagName: "a",
      properties: { href: url, target: "_blank", rel: "noopener noreferrer" },
      children: [{ type: "text", value: linkText }],
    });
    last = linkStart + linkText.length;
  }
  if (last < text.length) {
    parts.push({ type: "text", value: text.slice(last) });
  }
  return parts;
}

export function rehypeEthAddresses() {
  return () => (tree: Root) => {
    const addresses = getAddressMap();
    const replacements: Array<{ parent: Element; index: number; nodes: ElementContent[] }> = [];

    const codeReplacements: Array<{ parent: Element; index: number; node: ElementContent }> = [];
    visit(tree, "element", (node: Element, index, parent) => {
      if (index == null || !parent || node.tagName !== "code") return;
      if ("tagName" in parent && (parent as Element).tagName === "a") return;
      if (node.children.length !== 1 || node.children[0].type !== "text") return;
      const codeText = node.children[0].value.trim();
      if (!TX_HASH_BARE_RE.test(codeText)) return;
      const siblings = (parent as Element).children;
      for (let si = index - 1; si >= 0; si--) {
        const sib = siblings[si];
        if (sib.type === "text") {
          if (TX_LABEL_RE.test(sib.value)) {
            codeReplacements.push({
              parent: parent as Element,
              index,
              node: {
                type: "element",
                tagName: "a",
                properties: { href: `https://etherscan.io/tx/${codeText}`, target: "_blank", rel: "noopener noreferrer" },
                children: [node],
              },
            });
          }
          break;
        }
        if (sib.type === "element") break;
      }
    });
    for (const { parent, index, node } of codeReplacements.reverse()) {
      parent.children.splice(index, 1, node);
    }

    visit(tree, "text", (node: Text, index, parent) => {
      if (index == null || !parent) return;
      if ("tagName" in parent && (parent as Element).tagName === "a") return;

      const txParts = splitTextByPattern(node.value, TX_HASH_RE, (m) => ({
        linkText: m[1],
        url: `https://etherscan.io/tx/${m[1]}`,
      }));

      if (txParts) {
        const finalParts: ElementContent[] = [];
        for (const part of txParts) {
          if (part.type === "text") {
            const addrParts = splitTextByPattern(part.value, ONCHAIN_RE, (m) => {
              const addr = m[0];
              const lookupKey = addr.startsWith("0x") ? addr.toLowerCase() : addr;
              const url = addresses[lookupKey]?.explorerUrl ?? `https://etherscan.io/address/${addr}`;
              return { linkText: addr, url };
            });
            if (addrParts) finalParts.push(...addrParts);
            else finalParts.push(part);
          } else {
            finalParts.push(part);
          }
        }
        replacements.push({ parent: parent as Element, index, nodes: finalParts });
        return;
      }

      const addrParts = splitTextByPattern(node.value, ONCHAIN_RE, (m) => {
        const addr = m[0];
        const lookupKey = addr.startsWith("0x") ? addr.toLowerCase() : addr;
        const url = getAddressMap()[lookupKey]?.explorerUrl ?? `https://etherscan.io/address/${addr}`;
        return { linkText: addr, url };
      });
      if (addrParts) {
        replacements.push({ parent: parent as Element, index, nodes: addrParts });
      }
    });

    for (const { parent, index, nodes } of replacements.reverse()) {
      parent.children.splice(index, 1, ...nodes);
    }
  };
}

export const ethAddressesPlugin = rehypeEthAddresses();
