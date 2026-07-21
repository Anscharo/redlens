import type { LibraryData, LibraryNodeRef, LibrarySegment } from "../../lib/library";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";
import { SegmentedBar } from "./SegmentedBar";
import { LibraryScopeMass } from "./LibraryScopeMass";

interface Row {
  label: string;
  value: number;
  segments: LibrarySegment[];
  href?: string;
}

function WeightRow({ row, max }: { row: Row; max: number }) {
  return (
    <div className="grid items-center gap-2 mb-1.5" style={{ gridTemplateColumns: "minmax(11rem, 16rem) 1fr 3.5rem" }}>
      {row.href ? (
        <Link to={row.href} className="text-sm truncate link-accent">
          {row.label}
        </Link>
      ) : (
        <span className="text-sm truncate" style={{ color: "var(--tan-2)" }}>
          {row.label}
        </span>
      )}
      <SegmentedBar value={row.value} max={max} segments={row.segments} />
      <span className="mono text-xs text-right text-tan-3">{row.value.toLocaleString()}</span>
    </div>
  );
}

const nodeRows = (rows: LibraryNodeRef[]): Row[] =>
  rows.map((r) => ({ label: `${r.doc_no} ${r.title}`, value: r.docs, segments: r.segments, href: atlasHref(r.id) }));

export function LibraryShape({ data }: { data: LibraryData }) {
  const sections: { title: string; note?: string; rows: Row[] }[] = [
    {
      title: "Doc mass by chunk group",
      note: "Functional groups (the chunk taxonomy), not the raw scope tree. Segments are the component subtrees.",
      rows: data.groups.map((g) => ({ label: g.name, value: g.docs, segments: g.segments })),
    },
    {
      title: "Agent artifact weights",
      note: "Each prime carries the same primitive template — size difference is real operational activity. Segments: Sky Primitives / Omni Documents / Introduction.",
      rows: nodeRows([...data.primes, ...data.executors]),
    },
  ];
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
      {sections.map((s) => {
        const max = Math.max(...s.rows.map((r) => r.value), 1);
        return (
          <section key={s.title} className="mb-8">
            <h2 className="text-base font-semibold mb-1" style={{ color: "var(--tan)" }}>
              {s.title}
            </h2>
            {s.note && (
              <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
                {s.note}
              </p>
            )}
            <div className="mt-3">
              {s.rows.map((r) => (
                <WeightRow key={r.label} row={r} max={max} />
              ))}
            </div>
          </section>
        );
      })}
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
