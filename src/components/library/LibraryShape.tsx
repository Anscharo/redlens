import type { LibraryData } from "../../lib/library";
import { flattenChunkTree, libraryChunksToCSV } from "../../lib/library";
import { LibraryChunkTree } from "./LibraryChunkTree";
import { DownloadCsvButton } from "../reports/DownloadCsvButton";

export function LibraryShape({ data }: { data: LibraryData }) {
  const chunkRowCount = flattenChunkTree(data.chunkTree, data.totals.docs).length;
  const buildCsv = () => libraryChunksToCSV(data.chunkTree, data.totals.docs);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <p className="mono text-xs text-tan-3">
          {data.totals.docs.toLocaleString()} docs · {Math.round(data.totals.bytes / 1024)} KB of content ·{" "}
          {data.totals.glossaryTerms} glossary terms · atlas {data.atlasCommit.slice(0, 7)}
        </p>
        <DownloadCsvButton
          report="library"
          filename="atlas-library-chunks.csv"
          rowCount={chunkRowCount}
          build={buildCsv}
          fullRowCount={chunkRowCount}
          buildFull={buildCsv}
          query=""
        />
      </div>
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Doc mass by scope
        </h2>
        <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
          The editorial axis, same chunk semantics as the tree below: expand a scope to descend into its distinct
          chunks (wrapper levels are skipped — Agent Scope opens straight to the prime/executor artifact lists, then
          the agents themselves). Bars scale to the largest sibling; % is of the whole Atlas.
        </p>
        <LibraryChunkTree tree={data.scopeTree} atlasTotal={data.totals.docs} rootDocNo />
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
        <LibraryChunkTree tree={data.chunkTree} atlasTotal={data.totals.docs} />
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
    </div>
  );
}
