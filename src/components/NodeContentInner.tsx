import { createContext, useContext, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { Components } from "react-markdown";
import type { Root, Text, Element, ElementContent } from "hast";
import type { AnchorHTMLAttributes } from "react";
import { getAddressMap } from "../lib/addressMap";

interface Props {
  content: string;
  onNavigate?: (id: string) => void;
}

const NavigateContext = createContext<((id: string) => void) | undefined>(undefined);

const remarkPluginsBase = [remarkGfm];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ETH_ADDRESS_RE = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const SOL_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;
const ONCHAIN_RE = new RegExp(`${ETH_ADDRESS_RE.source}|${SOL_ADDRESS_RE.source}`, "g");
const TX_HASH_RE = /Transaction\s+Hash:\s*(0x[0-9a-fA-F]{64})\b/gi;

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

const TX_HASH_BARE_RE = /^0x[0-9a-fA-F]{64}$/;
const TX_LABEL_RE = /Transaction\s+Hash:\s*$/i;

function rehypeEthAddresses() {
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

function MarkdownLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) {
  const onNavigate = useContext(NavigateContext);
  if (href && UUID_RE.test(href) && onNavigate) {
    return (
      <a
        href={`${import.meta.env.BASE_URL}?id=${href}`}
        onClick={(e) => { e.preventDefault(); onNavigate(href); }}
        style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "3px" }}
        {...props}
      >
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "3px" }}
      {...props}
    >
      {children}
    </a>
  );
}

const components: Components = {
  a: MarkdownLink,
  p({ children }) {
    return <p className="mb-3 last:mb-0 leading-relaxed text-sm" style={{ color: "var(--tan-2)" }}>{children}</p>;
  },
  ul({ children }) {
    return <ul className="mb-3 pl-5 space-y-1 text-sm list-disc" style={{ color: "var(--tan-2)" }}>{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-3 pl-5 space-y-1 text-sm list-decimal" style={{ color: "var(--tan-2)" }}>{children}</ol>;
  },
  code({ children, className }) {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <code
          className={`block mono text-xs p-3 rounded overflow-x-auto mb-3 ${className ?? ""}`}
          style={{ background: "var(--surface)", color: "var(--tan)", border: "1px solid var(--border)" }}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="mono text-xs px-1 py-0.5 rounded"
        style={{ background: "var(--surface)", color: "var(--tan)", border: "1px solid var(--border)" }}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <pre className="mb-3">{children}</pre>;
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto mb-3">
        <table className="w-full text-xs border-collapse" style={{ color: "var(--tan-2)" }}>
          {children}
        </table>
      </div>
    );
  },
  th({ children }) {
    return (
      <th className="text-left px-3 py-2 font-semibold text-xs" style={{ borderBottom: "1px solid var(--border)", color: "var(--tan)" }}>
        {children}
      </th>
    );
  },
  td({ children }) {
    return <td className="px-3 py-2 text-xs" style={{ borderBottom: "1px solid var(--border)" }}>{children}</td>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="pl-3 mb-3 italic text-sm" style={{ borderLeft: "3px solid var(--border)", color: "var(--tan-3)" }}>
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="my-4" style={{ borderColor: "var(--border)" }} />;
  },
};

const MATH_RE = /\$\$|\$[^$\s]/;
const ethAddressesPlugin = rehypeEthAddresses();
const rehypePluginsBase = [ethAddressesPlugin];

let remarkPluginsMath: any[] | null = null;
let rehypePluginsMath: any[] | null = null;
let katexPromise: Promise<void> | null = null;

function loadKatex(): Promise<void> {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import("rehype-katex"),
      import("remark-math"),
      import("katex/dist/katex.min.css"),
    ]).then(([rehypeKatexMod, remarkMathMod]) => {
      remarkPluginsMath = [remarkGfm, remarkMathMod.default];
      rehypePluginsMath = [rehypeKatexMod.default, ethAddressesPlugin];
    });
  }
  return katexPromise;
}

export default function NodeContentInner({ content, onNavigate }: Props) {
  const hasMath = MATH_RE.test(content);
  const [katexReady, setKatexReady] = useState(!!rehypePluginsMath);

  useEffect(() => {
    if (hasMath && !rehypePluginsMath) {
      loadKatex().then(() => setKatexReady(true));
    }
  }, [hasMath]);

  const usesMath = hasMath && katexReady;

  return (
    <NavigateContext.Provider value={onNavigate}>
      <ReactMarkdown
        remarkPlugins={usesMath ? remarkPluginsMath! : remarkPluginsBase}
        rehypePlugins={usesMath ? rehypePluginsMath! : rehypePluginsBase}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </NavigateContext.Provider>
  );
}
