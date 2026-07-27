import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { Element as HastElement } from "hast";
import remarkGfm from "remark-gfm";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";
import { ConceptCensus } from "./ConceptCensus";
import { rehypeEvidencePills } from "../../lib/rehypeEvidencePills";

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const rehypePlugins = [rehypeEvidencePills()];

// A per-concept unit-opener paragraph starts with a bold "<Group> <N> ·
// <Title>" run (e.g. "**Lifecycle 7 · Omni Documents**") — distinct from a
// list item's bold field label ("**Definition**", "**Detection signature**"),
// which never carries a number + middot.
const UNIT_OPENER_RE = /^[A-Za-z][\w\s]*\d+\s*·/;

function hastText(node: HastElement): string {
  let out = "";
  for (const child of node.children) {
    if (child.type === "text") out += child.value;
    else if (child.type === "element") out += hastText(child);
  }
  return out;
}

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
    <h1 className="text-3xl font-semibold mt-2 mb-4" style={{ color: "var(--tan)" }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold mt-14 mb-3 pb-2 border-b border-[var(--border)]" style={{ color: "var(--tan)" }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold mt-10 mb-2" style={{ color: "var(--tan)" }}>{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold mt-4 mb-1" style={{ color: "var(--tan-2)" }}>{children}</h4>
  ),
  p: ({ node, children }) => {
    const first = node?.children[0];
    const isUnitOpener = !!first && first.type === "element" && first.tagName === "strong" && UNIT_OPENER_RE.test(hastText(first));
    return <p className={isUnitOpener ? "unit-opener" : undefined}>{children}</p>;
  },
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
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
            {seg.text}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
}
