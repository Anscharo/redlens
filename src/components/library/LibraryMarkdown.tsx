import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";
import { ConceptCensus } from "./ConceptCensus";

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

// A `:::census <slug>` line, alone on its own line, interleaves a live
// <ConceptCensus> block into the curated prose (docs/library/concepts.md).
// Only concepts.md uses this; concepts-audit.md has no markers, so this is a
// no-op split for it (one "md" segment, unchanged).
const CENSUS_MARKER_RE = /^:::census\s+([\w-]+)\s*$/gm;

type MarkdownSegment = { kind: "md"; text: string } | { kind: "census"; slug: string };

function splitByCensusMarkers(raw: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let cursor = 0;
  for (const m of raw.matchAll(CENSUS_MARKER_RE)) {
    const idx = m.index ?? 0;
    if (idx > cursor) segments.push({ kind: "md", text: raw.slice(cursor, idx) });
    segments.push({ kind: "census", slug: m[1] });
    cursor = idx + m[0].length;
  }
  if (cursor < raw.length) segments.push({ kind: "md", text: raw.slice(cursor) });
  return segments;
}

// Shared renderer for the library's curated markdown docs (Concepts, Audit) —
// bundled at build time via ?raw, RubricPage pattern. Inline code spans holding
// FULL UUIDs become reader deep-links; short-form pointers and doc_nos stay
// plain code (the reader's ?id= resolves UUIDs only).
const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-xl font-semibold mb-4" style={{ color: "var(--tan)" }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mt-8 mb-3 pb-1 border-b border-[var(--border)]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mt-5 mb-2" style={{ color: "var(--tan)" }}>{children}</h3>
  ),
  code: ({ children }) => {
    const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
    const t = text.trim();
    if (UUID_RE.test(t)) {
      return (
        <Link to={atlasHref(t)} className="mono text-xs link-accent" title={t}>
          {t.slice(0, 8)}
        </Link>
      );
    }
    return <code>{children}</code>;
  },
};

export function LibraryMarkdown({ raw }: { raw: string }) {
  const segments = splitByCensusMarkers(raw);
  return (
    <div className="atlas-md text-sm text-tan-2">
      {segments.map((seg, i) =>
        seg.kind === "census" ? (
          <ConceptCensus key={i} slug={seg.slug} />
        ) : (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={components}>
            {seg.text}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
}
