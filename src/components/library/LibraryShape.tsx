import type { LibraryData, LibraryNodeRef, LibrarySegment } from "../../lib/library";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";

// Stacked weight bar: sub-element segments largest→smallest, left→right, in a
// descending shade of --red so the internal composition is visible. Bar length
// is the row's share of the section max; segments fill it proportionally
// (normalized to the segment sum — the parent's own doc is a rounding sliver).
// Approximate rendered bar-track width; only used to decide which tail
// segments are too thin to see and should merge into one "+N smaller" block.
const TRACK_PX = 440;
const MIN_SEG_PX = 4;

function SegmentedBar({ value, max, segments }: { value: number; max: number; segments: LibrarySegment[] }) {
  const all = segments.filter((s) => s.docs > 0);
  const segSum = all.reduce((s, x) => s + x.docs, 0) || 1;
  const barPct = Math.max(1, (value / max) * 100);
  // Segments that would render thinner than MIN_SEG_PX collapse into one
  // tail block (they're sorted largest-first, so it's always a suffix).
  const pxOf = (docs: number) => (docs / segSum) * (barPct / 100) * TRACK_PX;
  const visible = all.filter((s) => pxOf(s.docs) >= MIN_SEG_PX);
  const tail = all.slice(visible.length);
  const tailDocs = tail.reduce((s, x) => s + x.docs, 0);
  const segs: (LibrarySegment & { isTail?: boolean })[] =
    tail.length > 1
      ? [...visible, { id: "__tail", doc_no: "", title: `${tail.length} smaller sections`, docs: tailDocs, isTail: true }]
      : all;
  return (
    <div className="h-3 rounded-sm" style={{ background: "var(--surface)" }}>
      <div className="h-full flex rounded-sm overflow-hidden" style={{ width: `${barPct}%`, gap: "1px" }}>
        {segs.length === 0 ? (
          <div className="h-full w-full" style={{ background: "var(--red)" }} />
        ) : (
          segs.map((s, i) => (
            <div
              key={s.id}
              className="h-full"
              title={`${s.doc_no ? `${s.doc_no} ` : ""}${s.title} — ${s.docs.toLocaleString()} docs`}
              style={{
                width: `${(s.docs / segSum) * 100}%`,
                background: "var(--red)",
                // Largest segment full strength, fading toward the small tail.
                opacity: s.isTail ? 0.3 : 1 - (segs.length > 1 ? (i / (segs.length - 1)) * 0.65 : 0),
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

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
      title: "Doc mass by scope",
      note: "Each bar splits into the scope's articles, largest first — hover a segment for its name.",
      rows: nodeRows(data.scopes),
    },
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
