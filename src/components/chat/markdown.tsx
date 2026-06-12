import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Agent citations are markdown links of the form [Title](/atlas/<uuid>)
// (system-prompt.ts forces UUID hrefs). We intercept those, SPA-navigate via
// onAtlas, and let any other href fall through to a normal new-tab link.
const ATLAS_HREF_RE = /^\/atlas\/([0-9a-f-]{36})$/i;
export const ATLAS_LINK_RE = /\[([^\]]+)\]\(\/atlas\/([0-9a-f-]{36})\)/gi;

export interface Source {
  uuid: string;
  title: string;
}

// Pull unique cited atlas docs out of the answer text, in order of appearance.
export function extractSources(content: string): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const m of content.matchAll(ATLAS_LINK_RE)) {
    const title = m[1];
    const uuid = m[2].toLowerCase();
    if (seen.has(uuid)) continue;
    seen.add(uuid);
    out.push({ uuid, title });
  }
  return out;
}

// Mid-stream, a half-streamed ``` fence would swallow the rest of the panel as
// a code block. If the fence count is odd, append a synthetic closer for
// rendering only (the raw buffer is untouched; done.content is authoritative).
export function balanceFences(text: string): string {
  const fences = (text.match(/```/g) ?? []).length;
  return fences % 2 === 1 ? text + "\n```" : text;
}

export function AtlasMarkdown({ content, onAtlas }: { content: string; onAtlas: (uuid: string) => void }) {
  const components = useMemo<Components>(
    () => ({
      a({ href, children, ...props }) {
        const m = href ? ATLAS_HREF_RE.exec(href) : null;
        if (m) {
          const uuid = m[1].toLowerCase();
          return (
            <a
              href={`/atlas?id=${uuid}`}
              onClick={(e) => {
                e.preventDefault();
                onAtlas(uuid);
              }}
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
      },
    }),
    [onAtlas],
  );

  return (
    <div className="rlc-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
