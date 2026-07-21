import type { LibraryData, LibraryNodeRef } from "../../lib/library";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";

function WeightRow({ label, value, max, href }: { label: string; value: number; max: number; href?: string }) {
  return (
    <div className="grid items-center gap-2 mb-1.5" style={{ gridTemplateColumns: "minmax(11rem, 16rem) 1fr 3.5rem" }}>
      {href ? (
        <Link to={href} className="text-sm truncate link-accent">
          {label}
        </Link>
      ) : (
        <span className="text-sm truncate" style={{ color: "var(--tan-2)" }}>
          {label}
        </span>
      )}
      <div className="h-3 rounded-sm" style={{ background: "var(--surface)" }}>
        <div
          className="h-full rounded-sm"
          style={{ width: `${Math.max(1, (value / max) * 100)}%`, background: "var(--red)" }}
        />
      </div>
      <span className="mono text-xs text-right text-tan-3">{value.toLocaleString()}</span>
    </div>
  );
}

const maxOf = (rows: { docs: number }[]) => Math.max(...rows.map((r) => r.docs), 1);
const nodeRows = (rows: LibraryNodeRef[]) =>
  rows.map((r) => ({ label: `${r.doc_no} ${r.title}`, value: r.docs, href: atlasHref(r.id) }));

export function LibraryShape({ data }: { data: LibraryData }) {
  const sections: { title: string; note?: string; rows: { label: string; value: number; href?: string }[] }[] = [
    { title: "Doc mass by scope", rows: nodeRows(data.scopes) },
    {
      title: "Doc mass by chunk group",
      note: "Functional groups (the chunk taxonomy), not the raw scope tree.",
      rows: data.groups.map((g) => ({ label: g.name, value: g.docs })),
    },
    {
      title: "Agent artifact weights",
      note: "Each prime carries the same primitive template — size difference is real operational activity.",
      rows: nodeRows([...data.primes, ...data.executors]),
    },
  ];
  return (
    <div>
      <p className="mono text-xs text-tan-3 mb-6">
        {data.totals.docs.toLocaleString()} docs · {Math.round(data.totals.bytes / 1024)} KB of content ·{" "}
        {data.totals.glossaryTerms} glossary terms · atlas {data.atlasCommit.slice(0, 7)}
      </p>
      {sections.map((s) => (
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
              <WeightRow key={r.label} label={r.label} value={r.value} max={maxOf(s.rows.map((x) => ({ docs: x.value })))} href={r.href} />
            ))}
          </div>
        </section>
      ))}
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
