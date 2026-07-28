import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { loadAtlas } from "../../lib/docs";
import { useDataSource } from "../../lib/dataSource";
import { ConceptCensus } from "./ConceptCensus";
import { rehypeEvidencePills } from "../../lib/rehypeEvidencePills";
import { rehypeDocRefs } from "../../lib/rehypeDocRefs";
import { buildDocRefResolver, type DocRefResolver } from "../../lib/docRefResolver";
import { buildComponents } from "./libraryMarkdownComponents";

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
// bundled at build time via ?raw, RubricPage pattern. Every atlas document
// reference (full UUID / short 8-hex pointer in a code span, bare doc_no in
// plain text) becomes a reader deep-link, "DOC_NO • Truncated Title" — see
// rehypeDocRefs.ts. Resolution needs the docs bundle (loaded below); until it
// resolves (or if it fails to load) we fall back to the old full-uuid-only
// behavior (see buildComponents in libraryMarkdownComponents.tsx) so the page
// never blocks on it.
export function LibraryMarkdown({ raw }: { raw: string }) {
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

  const rehypePlugins = useMemo(
    () => (resolver ? [rehypeEvidencePills(), rehypeDocRefs(resolver)] : [rehypeEvidencePills()]),
    [resolver],
  );
  const components = useMemo(() => buildComponents(resolver), [resolver]);

  if (!resolver && !failed) {
    return <p className="text-xs mono text-tan-3">loading…</p>;
  }

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
