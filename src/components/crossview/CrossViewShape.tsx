import type { CrossViewData } from "@/lib/crossview";
import { flattenChunkTree, crossviewChunksToCSV } from "@/lib/crossview";
import { CrossViewChunkTree } from "./CrossViewChunkTree";
import { CrossViewTreemap } from "./CrossViewTreemap";
import { DownloadCsvButton } from "../reports/DownloadCsvButton";
import { Link } from "../Link";
import { atlasHref } from "@/lib/routes";

export function CrossViewShape({ data }: { data: CrossViewData }) {
  const chunkRowCount = flattenChunkTree(data.chunkTree, data.totals.docs).length;
  const buildCsv = () => crossviewChunksToCSV(data.chunkTree, data.totals.docs);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <p className="mono text-xs text-tan-3">
          {data.totals.docs.toLocaleString()} docs · {Math.round(data.totals.bytes / 1024)} KB of content ·{" "}
          {data.totals.glossaryTerms} glossary terms · atlas {data.atlasCommit.slice(0, 7)}
        </p>
        <DownloadCsvButton
          report="crossview"
          filename="atlas-crossview-chunks.csv"
          rowCount={chunkRowCount}
          build={buildCsv}
          fullRowCount={chunkRowCount}
          buildFull={buildCsv}
          query=""
        />
      </div>
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Chunk map
        </h2>
        <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
          The whole Atlas as one square. Each chunk&apos;s area is its share of the corpus; its
          largest sub-chunk sits in its top-left, recursively. Hover for details.
        </p>
        <CrossViewTreemap tree={data.chunkTree} atlasTotal={data.totals.docs} />
      </section>
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Doc mass by scope
        </h2>
        <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
          The editorial axis, same chunk semantics as the tree below: expand a scope to descend into its distinct
          chunks (wrapper levels are skipped — Agent Scope opens straight to the prime/executor artifact lists, then
          the agents themselves). Bars scale to the largest sibling; % is of the whole Atlas.
        </p>
        <CrossViewChunkTree tree={data.scopeTree} atlasTotal={data.totals.docs} rootDocNo />
      </section>
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Chunk tree
        </h2>
        <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
          The Atlas as functional chunks with their sub-chunks — expand a row to descend; bars are scaled to the
          largest sibling at each level, and the % is of the whole Atlas. Agent artifacts break down per agent, then
          into primitives, hubs, and instances.
        </p>
        <CrossViewChunkTree tree={data.chunkTree} atlasTotal={data.totals.docs} />
      </section>
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Overlay chunks
        </h2>
        <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
          Document types that cross the tree — each instance attaches to a host section.
        </p>
        <div className="flex flex-wrap gap-2">
          {data.docTypes.map(([type, count]) => (
            <span key={type} className="mono text-xs px-2 py-1 rounded" style={{ background: "var(--surface)", color: "var(--tan-2)" }}>
              {type} <span className="text-tan-3">{count.toLocaleString()}</span>
            </span>
          ))}
        </div>
      </section>
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Needed Research
        </h2>
        <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
          Open research questions the Atlas poses to itself — globally numbered, outside the scope tree.
        </p>
        <ul className="ml-1">
          {data.neededResearch.map((n) => (
            <li key={n.id} className="mb-0.5">
              <Link to={atlasHref(n.id)} className="text-sm link-accent">
                {n.doc_no} {n.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
