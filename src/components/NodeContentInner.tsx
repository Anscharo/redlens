import { createContext, useContext, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { AnchorHTMLAttributes } from "react";
import { ethAddressesPlugin, rehypeEthAddresses } from "../lib/rehypeEthAddresses";

interface Props {
  content: string;
  onNavigate?: (id: string) => void;
}

const NavigateContext = createContext<((id: string) => void) | undefined>(undefined);

const remarkPluginsBase = [remarkGfm];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// UUID and eth-address links — styling via .atlas-md a in CSS
function MarkdownLink({ href, children, node: _node, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode; node?: unknown }) {
  const onNavigate = useContext(NavigateContext);
  if (href && UUID_RE.test(href) && onNavigate) {
    return (
      <a
        href={`/atlas?id=${href}`}
        onClick={(e) => { e.preventDefault(); onNavigate(href); }}
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

function loadKatex(): Promise<void> {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import("rehype-katex"),
      import("remark-math"),
      import("katex/dist/katex.min.css"),
    ]).then(([rehypeKatexMod, remarkMathMod]) => {
      remarkPluginsMath = [remarkGfm, remarkMathMod.default];
      rehypePluginsMath = [rehypeKatexMod.default, rehypeEthAddresses()];
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
      <div className="atlas-md">
        <ReactMarkdown
          remarkPlugins={usesMath ? remarkPluginsMath! : remarkPluginsBase}
          rehypePlugins={usesMath ? rehypePluginsMath! : rehypePluginsBase}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </NavigateContext.Provider>
  );
}
