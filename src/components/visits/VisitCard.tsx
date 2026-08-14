// Card frame shared by the four /history sections: a heading, a one-line
// explanation of what the card counts, the "View Count" column header, and
// either the rows or a per-card empty line.
export function VisitCard({
  title,
  blurb,
  empty,
  children,
}: {
  title: string;
  blurb: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <header className="mb-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--tan)" }}>
            {title}
          </h2>
          {!empty && (
            <span className="mono text-[10px] uppercase tracking-wider shrink-0" style={{ color: "var(--tan-3)" }}>
              View Count
            </span>
          )}
        </div>
        <p className="mono text-[10px] mt-1" style={{ color: "var(--gray)" }}>
          {blurb}
        </p>
      </header>
      {empty ? (
        <p className="mono text-xs" style={{ color: "var(--tan-3)" }}>
          Nothing here yet.
        </p>
      ) : (
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {children}
        </div>
      )}
    </article>
  );
}
