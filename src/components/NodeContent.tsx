import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { visit } from "unist-util-visit";
import "katex/dist/katex.min.css";
import type { Components } from "react-markdown";
import type { Root, Text, Element, ElementContent } from "hast";
import type { AnchorHTMLAttributes } from "react";

interface Props {
  content: string;
  addresses?: Record<string, { chain: string; explorerUrl: string }>;
  onNavigate?: (id: string) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ETH_ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;
const SOL_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;
const ONCHAIN_RE = new RegExp(`${ETH_ADDRESS_RE.source}|${SOL_ADDRESS_RE.source}`, "g");

// Rehype plugin: link addresses using the pre-built map from the build step
function rehypeEthAddresses(addressMap: Record<string, { explorerUrl: string }>) {
  return () => (tree: Root) => {
    const replacements: Array<{ parent: Element; index: number; nodes: ElementContent[] }> = [];

    visit(tree, "text", (node: Text, index, parent) => {
      if (index == null || !parent) return;
      if ("tagName" in parent && (parent as Element).tagName === "a") return;

      ONCHAIN_RE.lastIndex = 0;
      if (!ONCHAIN_RE.test(node.value)) return;
      ONCHAIN_RE.lastIndex = 0;

      const parts: ElementContent[] = [];
      let last = 0;
      let match: RegExpExecArray | null;

      while ((match = ONCHAIN_RE.exec(node.value)) !== null) {
        if (match.index > last) {
          parts.push({ type: "text", value: node.value.slice(last, match.index) });
        }
        const addr = match[0];
        const url = addressMap[addr]?.explorerUrl ?? `https://etherscan.io/address/${addr}`;
        parts.push({
          type: "element",
          tagName: "a",
          properties: { href: url, target: "_blank", rel: "noopener noreferrer" },
          children: [{ type: "text", value: addr }],
        });
        last = match.index + addr.length;
      }
      if (last < node.value.length) {
        parts.push({ type: "text", value: node.value.slice(last) });
      }

      replacements.push({ parent: parent as Element, index, nodes: parts });
    });

    for (const { parent, index, nodes } of replacements.reverse()) {
      parent.children.splice(index, 1, ...nodes);
    }
  };
}

export function NodeContent({ content, addresses = {}, onNavigate }: Props) {
  const components: Components = {
    // UUID links → internal navigation; eth addresses → Etherscan
    a({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) {
      if (href && UUID_RE.test(href) && onNavigate) {
        return (
          <a
            href={`/?id=${href}`}
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
    },

    p({ children }) {
      return (
        <p className="mb-3 last:mb-0 leading-relaxed text-sm" style={{ color: "var(--tan-2)" }}>
          {children}
        </p>
      );
    },

    ul({ children }) {
      return (
        <ul className="mb-3 pl-5 space-y-1 text-sm list-disc" style={{ color: "var(--tan-2)" }}>
          {children}
        </ul>
      );
    },
    ol({ children }) {
      return (
        <ol className="mb-3 pl-5 space-y-1 text-sm list-decimal" style={{ color: "var(--tan-2)" }}>
          {children}
        </ol>
      );
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
        <th
          className="text-left px-3 py-2 font-semibold text-xs"
          style={{ borderBottom: "1px solid var(--border)", color: "var(--tan)" }}
        >
          {children}
        </th>
      );
    },
    td({ children }) {
      return (
        <td className="px-3 py-2 text-xs" style={{ borderBottom: "1px solid var(--border)" }}>
          {children}
        </td>
      );
    },

    blockquote({ children }) {
      return (
        <blockquote
          className="pl-3 mb-3 italic text-sm"
          style={{ borderLeft: "3px solid var(--border)", color: "var(--tan-3)" }}
        >
          {children}
        </blockquote>
      );
    },

    hr() {
      return <hr className="my-4" style={{ borderColor: "var(--border)" }} />;
    },
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeEthAddresses(addresses)]}

      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}
