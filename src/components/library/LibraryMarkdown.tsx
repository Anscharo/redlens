import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { loadAtlas } from "../../lib/docs";
import { useDataSource } from "../../lib/dataSource";
import { ConceptCensus } from "./ConceptCensus";
import { rehypeEvidencePills } from "../../lib/rehypeEvidencePills";
import { rehypeDocRefs } from "../../lib/rehypeDocRefs";
import { rehypeHeadingIds } from "../../lib/rehypeHeadingIds";
import { extractHeadings, partitionHeadings } from "../../lib/libraryHeadings";
import { parseLibraryIndex } from "../../lib/libraryIndex";
import { buildDocRefResolver, type DocRefResolver } from "../../lib/docRefResolver";
import { buildComponents } from "./libraryMarkdownComponents";
import { LibraryIndexList } from "./LibraryIndexList";

// A `:::census <slug>` line, alone on its own line, interleaves a live
// <ConceptCensus> block into the curated prose (docs/library/concepts.md).
// A `:::index` … `:::endindex` block wraps the II.7 Topics list — stripped
// out of the plain-markdown pass entirely and swapped for <LibraryIndexList>
// so its "→ Group N" targets render as hash links instead of plain text
// (see libraryIndex.ts). Only concepts.md uses either marker;
// concepts-audit.md has neither, so this is a no-op split for it (one "md"
// segment, unchanged).
const CENSUS_MARKER_RE = /^:::census\s+([\w-]+)\s*$/gm;
const INDEX_MARKER_RE = /^:::index\s*$\n[\s\S]*?^:::endindex\s*$/gm;

type MarkdownSegment = { kind: "md"; text: string } | { kind: "census"; slug: string } | { kind: "index" };

function splitByMarkers(raw: string): MarkdownSegment[] {
  const markers = [...raw.matchAll(CENSUS_MARKER_RE), ...raw.matchAll(INDEX_MARKER_RE)].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  const segments: MarkdownSegment[] = [];
  let cursor = 0;
  for (const m of markers) {
    const idx = m.index ?? 0;
    if (idx > cursor) segments.push({ kind: "md", text: raw.slice(cursor, idx) });
    segments.push(m[1] !== undefined ? { kind: "census", slug: m[1] } : { kind: "index" });
    cursor = idx + m[0].length;
  }
  if (cursor < raw.length) segments.push({ kind: "md", text: raw.slice(cursor) });
  return segments;
}

// Shared renderer for the library's curated markdown docs (Concepts, Audit) —
// bundled at build time via ?raw, RubricPage pattern. Every atlas document
// reference (full UUID / short 8-hex pointer in a code span, bare doc_no in
// plain text) becomes a reader deep-link, "DOC_NO • Truncated Title" — see
// rehypeDocRefs.ts. Resolution needs the docs bundle (loaded below); until it
// resolves (or if it fails to load) we fall back to the old full-uuid-only
// behavior (see buildComponents in libraryMarkdownComponents.tsx) so the page
// never blocks on it.
export function LibraryMarkdown({ raw, sticky = false }: { raw: string; sticky?: boolean }) {
  const { base } = useDataSource();
  const [resolver, setResolver] = useState<DocRefResolver | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let on = true;
    loadAtlas(base)
      .then((bundle) => on && setResolver(buildDocRefResolver(bundle)))
      .catch(() => on && setFailed(true));
    return () => {
      on = false;
    };
  }, [base]);

  // One extraction pass over the raw source, shared with the Concepts TOC —
  // see libraryHeadings.ts. Memoized on `raw` only (stable across resolver
  // loads): the doc's heading outline never depends on doc-ref resolution.
  const headings = useMemo(() => extractHeadings(raw), [raw]);
  const segments = useMemo(() => splitByMarkers(raw), [raw]);
  // Each `:::census`/`:::index`-split segment gets ONLY the headings that
  // occur in its own text, not a cursor shared across segments — see
  // rehypeHeadingIds.ts and partitionHeadings' doc comment for why (React
  // StrictMode's dev-mode double-invoke of a segment's render would
  // otherwise double-count).
  const headingsBySegment = useMemo(
    () => partitionHeadings(headings, segments.map((s) => (s.kind === "md" ? s.text : ""))),
    [headings, segments],
  );
  // Parsed once from the full raw source (not the stripped segment text —
  // parseLibraryIndex locates the II.7 section itself via its own heading
  // regex), shared with the right-hand LibraryTopicIndex.tsx panel so both
  // surfaces agree on every target's slug.
  const indexEntries = useMemo(() => parseLibraryIndex(raw, headings), [raw, headings]);

  // On mount/hash-change (a Link elsewhere in the app pointing at
  // "#slug" — client-side nav never fires the browser's own fragment
  // scroll), jump to the target once headings have actually rendered.
  // Mirrors ActorDashboard.tsx's radar precedent.
  useEffect(() => {
    if (!resolver && !failed) return; // still loading — no headings rendered yet
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [resolver, failed]);

  if (!resolver && !failed) {
    return <p className="text-xs mono text-tan-3">loading…</p>;
  }

  const components = buildComponents(resolver);

  return (
    <div className={`atlas-md library-md text-sm text-tan-2${sticky ? " library-sticky-headings" : ""}`}>
      {segments.map((seg, i) =>
        seg.kind === "census" ? (
          <ConceptCensus key={i} slug={seg.slug} />
        ) : seg.kind === "index" ? (
          <LibraryIndexList key={i} entries={indexEntries} />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[
              rehypeEvidencePills(),
              ...(resolver ? [rehypeDocRefs(resolver)] : []),
              rehypeHeadingIds(headingsBySegment[i] ?? []),
            ]}
            components={components}
          >
            {seg.text}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
}
