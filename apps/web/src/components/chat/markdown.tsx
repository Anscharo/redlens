import { useMemo, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { atlasHref } from "@/lib/routes";
import { extractCitedDocs, type CitedDoc } from "@/lib/citationScan";
import { unwrapCodeCitations } from "./citations";
import { useMathPlugins, closeOpenMathFence } from "./chatMath";

// Agent citations are markdown links of the form [Title](/atlas/<uuid>)
// (system-prompt.ts forces UUID hrefs). We intercept those, SPA-navigate via
// onAtlas, and let any other href fall through to a normal new-tab link.
const ATLAS_HREF_RE = /^\/atlas\/([0-9a-f-]{36})$/i;

// The scan itself lives in src/lib/citationScan.ts so the server derives a
// conversation's cited docs from the same code. It must keep tracking what
// AtlasMarkdown (react-markdown/remark) renders as an atlas link.
export type Source = CitedDoc;
export const extractSources = extractCitedDocs;

// Mid-stream, a half-streamed ``` fence would swallow the rest of the panel as
// a code block. If the fence count is odd, append a synthetic closer for
// rendering only (the raw buffer is untouched; done.content is authoritative).
// A half-open $$ display-math block has the same failure mode, but worse —
// see closeOpenMathFence (chatMath.ts) for why it needs different handling.
export function balanceFences(text: string): string {
  const fences = (text.match(/```/g) ?? []).length;
  const closed = fences % 2 === 1 ? text + "\n```" : text;
  return closeOpenMathFence(closed);
}

// Atlas citation links SPA-navigate through `onAtlas`; every other href opens
// in a new tab.
function markdownComponents(onAtlas: (uuid: string) => void): Components {
  return {
    a({ href, children, ...props }) {
      const m = href ? ATLAS_HREF_RE.exec(href) : null;
      if (!m) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      }
      const uuid = m[1].toLowerCase();
      const open = (e: MouseEvent) => {
        e.preventDefault();
        onAtlas(uuid);
      };
      return (
        <a href={atlasHref(uuid)} onClick={open}>
          {children}
        </a>
      );
    },
  };
}

export function AtlasMarkdown({ content, onAtlas }: { content: string; onAtlas: (uuid: string) => void }) {
  const components = useMemo(() => markdownComponents(onAtlas), [onAtlas]);
  const { remarkPlugins, rehypePlugins } = useMathPlugins(content);
  return (
    <div className="rlc-md">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {unwrapCodeCitations(content)}
      </ReactMarkdown>
    </div>
  );
}
