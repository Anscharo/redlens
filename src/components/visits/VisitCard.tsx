// Card frame shared by the four /history sections: a heading, a one-line
// explanation of what the card counts, the "View Count" column header, and
// either the rows or a per-card empty line.
export function VisitCard({
  title,
  blurb,
  empty,
  showCount = true,
  children,
}: {
  title: string;
  blurb: string;
  empty: boolean;
  /** Whether the rows carry a view count — off for the recency card, which is
   *  answering "when", not "how often". */
  showCount?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article
      className="rounded border p-4 h-fit"
      style={{ borderColor: "var(--border)", background: "var(--bg-deep)" }}
    >
      <header className="mb-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold" style={{ color: "var(--tan)" }}>
            {title}
          </h2>
          {!empty && showCount && (
            <span className="mono text-[11px] uppercase tracking-wider shrink-0" style={{ color: "var(--tan-3)" }}>
              View Count
            </span>
          )}
        </div>
        <p className="mono text-[13px] mt-1" style={{ color: "var(--gray)" }}>
          {blurb}
        </p>
      </header>
      {empty ? (
        <p className="mono text-[13px]" style={{ color: "var(--tan-3)" }}>
          Nothing here yet.
        </p>
      ) : (
        <div className="visit-rows">{children}</div>
      )}
    </article>
  );
}
