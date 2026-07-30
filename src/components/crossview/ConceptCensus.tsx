import { useEffect, useState } from "react";
import { loadAtlas } from "../../lib/docs";
import { computeConceptsCensus, type CensusResult, type CensusSlug } from "../../lib/conceptsCensus";
import { track } from "../../lib/analytics";
import { toCSV } from "../../lib/csv";
import { downloadCSV } from "../../lib/csvDownload";
import { useDataSource } from "../../lib/dataSource";
import { ConceptCensusMembers } from "./ConceptCensusMembers";

// Interleaved into docs/crossview/concepts.md via a `:::census <slug>` marker
// line (see CrossViewMarkdown.tsx's splitByCensusMarkers) — every censused
// number in the prose gets a live, re-runnable block instead of a frozen
// count, per the byte-reproducible-⇒-data admission rule in the atlas
// crossview plan. Computed client-side from loadAtlas() (no new artifact),
// mirroring loadCrossView()'s pattern — see src/lib/conceptsCensus.ts.
//
// Keyed by data-source base: under /preview/<id>/… useDataSource() supplies a
// non-live base, and a single unkeyed promise would leak the first-loaded
// (often live) bundle into every preview render instead of the preview data.
const censusPromises = new Map<string, Promise<Record<CensusSlug, CensusResult>>>();
function loadCensus(base: string): Promise<Record<CensusSlug, CensusResult>> {
  let censusPromise = censusPromises.get(base);
  if (!censusPromise) {
    censusPromise = loadAtlas(base)
      .then((bundle) => computeConceptsCensus(bundle.docs))
      .catch((err) => {
        censusPromises.delete(base); // don't cache the rejection — retry on next call
        throw err;
      });
    censusPromises.set(base, censusPromise);
  }
  return censusPromise;
}

export function ConceptCensus({ slug }: { slug: string }) {
  const { base } = useDataSource();
  const [all, setAll] = useState<Record<CensusSlug, CensusResult> | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let on = true;
    loadCensus(base)
      .then((c) => on && setAll(c))
      .catch(() => on && setError(true));
    return () => {
      on = false;
    };
  }, [base]);

  if (error) {
    return <p className="text-xs mono" style={{ color: "var(--error-text)" }}>census failed to load</p>;
  }
  if (!all) return <p className="text-xs mono text-tan-3">computing census…</p>;
  const result = all[slug as CensusSlug];
  if (!result) {
    return <p className="text-xs mono" style={{ color: "var(--error-text)" }}>unknown census slug &quot;{slug}&quot;</p>;
  }

  const exportCsv = () => {
    track("report_export", { report: `crossview-concepts-census-${slug}`, format: "csv", scope: "full", row_count: result.members.length });
    const rows = result.members.map((m) => [m.uuid, m.doc_no, m.title, m.bucket ?? ""]);
    downloadCSV(`concepts-census-${slug}.csv`, toCSV(["UUID", "Doc No", "Title", "Bucket"], rows));
  };

  return (
    <aside className="my-4 rounded border p-3" style={{ borderColor: "var(--border)" }}>
      <header className="flex items-center justify-between gap-2 mb-2">
        <h4 className="mono text-xs uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
          census: {result.title}
        </h4>
        <button type="button" className="mono text-xs link-accent" onClick={exportCsv} disabled={result.members.length === 0}>
          Download CSV
        </button>
      </header>
      <p className="text-xs mb-2" style={{ color: "var(--tan-2)" }}>
        <span className="mono">[{result.signature.kind}]</span> {result.signature.pattern}
      </p>
      <p className="text-xs mb-2 mono tabular-nums" style={{ color: "var(--tan)" }}>
        {Object.entries(result.counts)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ")}
      </p>
      {result.notes && (
        <p className="text-xs mb-2 italic" style={{ color: "var(--tan-3)" }}>
          {result.notes}
        </p>
      )}
      <button type="button" className="mono text-xs link-accent" onClick={() => setExpanded((e) => !e)}>
        {expanded ? "Hide" : "Show"} {result.members.length} member{result.members.length === 1 ? "" : "s"}
      </button>
      {expanded && <ConceptCensusMembers members={result.members} />}
    </aside>
  );
}
