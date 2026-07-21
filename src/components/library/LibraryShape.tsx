import type { LibraryData } from "../../lib/library";
import { LibraryScopeMass } from "./LibraryScopeMass";
import { LibraryChunkTree } from "./LibraryChunkTree";

export function LibraryShape({ data }: { data: LibraryData }) {
  return (
    <div>
      <p className="mono text-xs text-tan-3 mb-6">
        {data.totals.docs.toLocaleString()} docs · {Math.round(data.totals.bytes / 1024)} KB of content ·{" "}
        {data.totals.glossaryTerms} glossary terms · atlas {data.atlasCommit.slice(0, 7)}
      </p>
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Doc mass by scope
        </h2>
        <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
          Each bar splits into the scope&apos;s articles, largest first — hover a segment for its name, click a row to
          expand it.
        </p>
        <LibraryScopeMass scopes={data.scopes} atlasTotal={data.totals.docs} />
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
