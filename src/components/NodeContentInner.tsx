import { createContext, useContext, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { AnchorHTMLAttributes } from "react";
import { ethAddressesPlugin, rehypeEthAddresses } from "../lib/rehypeEthAddresses";
import { UUID_RE } from "../lib/patterns";
import { atlasHref } from "../lib/routes";

interface Props {
  content: string;
  onNavigate?: (id: string) => void;
}

const NavigateContext = createContext<((id: string) => void) | undefined>(undefined);
function useNavigateContext() {
  return useContext(NavigateContext);
}

// UUID and eth-address links — styling via .atlas-md a in CSS
function MarkdownLink({
  href,
  children,
  node: _node,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode; node?: unknown }) {
  const onNavigate = useNavigateContext();
  if (href && UUID_RE.test(href) && onNavigate) {
    return (
      <a
        href={atlasHref(href)}
        onClick={(e) => {
          e.preventDefault();
          onNavigate(href);
        }}
        {...props}
      >
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  );
}

const components: Components = {
  a: MarkdownLink,
  table({ children }) {
    return (
      <div className="overflow-x-auto mb-3">
        <table>{children}</table>
      </div>
    );
  },
};

const MATH_RE = /\$\$|\$[^$\s]/;
const rehypePluginsBase = [ethAddressesPlugin];

let remarkPluginsMath: any[] | null = null;
let rehypePluginsMath: any[] | null = null;
let katexPromise: Promise<void> | null = null;

// KaTeX renders synchronously, so a wall-clock timeout isn't possible — these
// bound the work instead: maxExpand kills macro-expansion bombs (\def chains),
// maxSize caps glyphs at 50em (no viewport-filling rules from hostile previews).
// Render errors stay inline (errorColor); anything that still throws is caught
// by NodeContent's per-node ErrorBoundary.
const KATEX_OPTIONS = { maxExpand: 1000, maxSize: 50, errorColor: "var(--red)" };

function loadKatex(): Promise<void> {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import("rehype-katex"),
      import("remark-math"),
      import("katex/dist/katex.min.css"),
    ]).then(([rehypeKatexMod, remarkMathMod]) => {
      remarkPluginsMath = [remarkGfm, remarkMathMod.default];
      rehypePluginsMath = [[rehypeKatexMod.default, KATEX_OPTIONS], rehypeEthAddresses()];
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
    <NavigateContext value={onNavigate}>
      <div className="atlas-md">
        <ReactMarkdown
          remarkPlugins={usesMath ? remarkPluginsMath! : [remarkGfm]}
          rehypePlugins={usesMath ? rehypePluginsMath! : rehypePluginsBase}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </NavigateContext>
  );
}
