import { createContext, useContext, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { AnchorHTMLAttributes } from "react";
import { ethAddressesPlugin, rehypeEthAddresses } from "../lib/rehypeEthAddresses";
import { remarkDeMathProse } from "../lib/mathGuard";
import { UUID_RE } from "../lib/patterns";
import { atlasHref } from "../lib/routes";
import { resolveAtlasRef } from "../lib/docs";
import { useDataSource } from "../lib/dataSource";
import { track } from "../lib/analytics";
import { rehypeHighlightMarks } from "../lib/rehypeHighlightMarks";
import type { ReportQuery } from "../lib/reportFilter";

interface Props {
  content: string;
  onNavigate?: (id: string) => void;
  highlight?: ReportQuery;
  noMath?: boolean;
}

const NavigateContext = createContext<((id: string) => void) | undefined>(undefined);
function useNavigateContext() {
  return useContext(NavigateContext);
}

// A sky-atlas.io reader deep-link (hash route, e.g. https://sky-atlas.io/#<uuid>
// or .../#A.3.7.1.2.2). Atlas prose sometimes points back to the external reader
// when referring to other sections; we internalise those. The `#` is required —
// only deep-links to a specific node, not the bare site, are candidates.
const SKY_ATLAS_REF_RE = /^https?:\/\/(?:www\.)?sky-atlas\.io\/?#(.+)$/i;

// Resolve a content link to an internal node id, or null to keep it external.
// Bare UUID hrefs (`[text](uuid)`, the atlas's native cross-ref form) navigate
// internally regardless. sky-atlas.io deep-links are internalised only when the
// referenced node (by UUID or doc_no) is one we host — otherwise we leave the
// outlink intact.
function internalTargetId(base: string, href: string): string | null {
  if (UUID_RE.test(href)) return href;
  const m = SKY_ATLAS_REF_RE.exec(href);
  if (!m) return null;
  let fragment: string;
  try {
    fragment = decodeURIComponent(m[1]);
  } catch {
    fragment = m[1];
  }
  return resolveAtlasRef(base, fragment) ?? null;
}

// UUID and eth-address links — styling via .atlas-md a in CSS
function MarkdownLink({
  href,
  children,
  node: _node,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode; node?: unknown }) {
  const onNavigate = useNavigateContext();
  const { base } = useDataSource();
  const targetId = href ? internalTargetId(base, href) : null;
  if (targetId && onNavigate) {
    return (
      <a
        href={atlasHref(targetId)}
        onClick={(e) => {
          e.preventDefault();
          track("reader_content_link", { target_id: targetId });
          onNavigate(targetId);
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
    ])
      .then(([rehypeKatexMod, remarkMathMod]) => {
        // remarkDeMathProse runs AFTER remark-math to reclassify inline-math
        // spans that are actually prose/currency (e.g. a `$100k … | … $` table
        // row) back to literal text, so KaTeX never garbles them.
        remarkPluginsMath = [remarkGfm, remarkMathMod.default, remarkDeMathProse];
        rehypePluginsMath = [[rehypeKatexMod.default, KATEX_OPTIONS], rehypeEthAddresses()];
      })
      .catch((err) => {
        // A rejected dynamic import (e.g. a stale chunk URL after a redeploy)
        // would otherwise cache forever — every future math node would await
        // the same dead promise and never render KaTeX again this session.
        // Clear it so the next node with math content retries the import.
        katexPromise = null;
        throw err;
      });
  }
  return katexPromise;
}

export default function NodeContentInner({ content, onNavigate, highlight, noMath }: Props) {
  const hasMath = !noMath && MATH_RE.test(content);
  const [katexReady, setKatexReady] = useState(!!rehypePluginsMath);

  useEffect(() => {
    if (hasMath && !rehypePluginsMath) {
      loadKatex()
        .then(() => setKatexReady(true))
        .catch(() => {
          // Leave katexReady false — plain markdown (with raw $...$ delimiters)
          // still renders via NodeContent's ErrorBoundary/fallback path, and a
          // later node/effect run will retry now that katexPromise was cleared.
        });
    }
  }, [hasMath]);

  const usesMath = hasMath && katexReady;
  const rehypeBase = usesMath ? rehypePluginsMath! : rehypePluginsBase;
  // Highlight marks run LAST so they can wrap text produced by the earlier
  // plugins (link labels, address links) without those re-splitting a <mark>.
  const rehypePlugins = highlight?.needles.length
    ? [...rehypeBase, rehypeHighlightMarks(highlight)]
    : rehypeBase;

  return (
    <NavigateContext value={onNavigate}>
      <div className="atlas-md">
        <ReactMarkdown
          remarkPlugins={usesMath ? remarkPluginsMath! : [remarkGfm]}
          rehypePlugins={rehypePlugins}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </NavigateContext>
  );
}
