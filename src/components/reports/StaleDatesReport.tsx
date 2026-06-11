import { useMemo } from "react";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import { loadDocs } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { buildStaleDatesReport, type DateClaim } from "../../lib/staleDates";

function staleness(c: DateClaim): string {
  if (c.daysUntilStale < 0) return `${-c.daysUntilStale}d overdue`;
  if (c.daysUntilStale === 0) return "today";
  return `in ${c.daysUntilStale}d`;
}

function ClaimRow({ c, tone }: { c: DateClaim; tone: string }) {
  return (
    <div className="py-2 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="mono text-xs" style={{ color: tone }}>
          {c.dateISO}
        </span>
        <span className="mono text-[10px] text-tan-3">{staleness(c)}</span>
        <AtlasLink
          to={atlasHref(c.docId)}
          className="mono text-xs text-accent hover:underline"
          title={c.title}
        >
          {c.docNo}
        </AtlasLink>
        <span className="text-xs" style={{ color: "var(--tan)" }}>
          {c.title}
        </span>
      </div>
      <p className="text-[11px] mt-1 text-tan-3">…{c.context}…</p>
    </div>
  );
}

function Section({ title, hint, claims, tone }: { title: string; hint: string; claims: DateClaim[]; tone: string }) {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold mb-0.5" style={{ color: tone }}>
        {title} <span className="mono text-xs text-tan-3">({claims.length})</span>
      </h2>
      <p className="text-xs text-tan-3 mb-2">{hint}</p>
      {claims.length === 0 ? (
        <p className="mono text-xs text-tan-3">none</p>
      ) : (
        claims.map((c, i) => <ClaimRow key={`${c.docId}:${c.dateISO}:${i}`} c={c} tone={tone} />)
      )}
    </section>
  );
}

export function StaleDatesReport() {
  const docs = useLoaded(loadDocs);
  // Recomputed from the loaded atlas + the actual current date on every
  // visit — no build step involved, so it can never serve yesterday's view.
  const report = useMemo(() => (docs ? buildStaleDatesReport(docs) : null), [docs]);

  return (
    <div className="px-6 py-6">
      <div className="max-w-4xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Stale Dates
        </h1>
        <p className="text-sm text-tan-3 mb-6">
          Future-tense claims in atlas prose ("will be included in the … Executive Vote") checked
          against today's date. An overdue claim means the event happened and the text was never
          updated — or it slipped.
          {report && (
            <span className="mono text-xs"> {report.totalDateMentions} dated mentions scanned.</span>
          )}
        </p>
        {!report ? (
          <p className="mono text-xs text-tan-3">loading…</p>
        ) : (
          <>
            <Section
              title="Stale"
              hint="The date has passed but the atlas still phrases the event as future."
              claims={report.stale}
              tone="var(--red)"
            />
            <Section
              title="Due within 7 days"
              hint="Future claims about to cross today — stale next week unless the atlas is updated."
              claims={report.dueSoon}
              tone="#c9a227"
            />
            <Section
              title="Upcoming"
              hint="The atlas's live calendar — future claims with dates still ahead."
              claims={report.upcoming}
              tone="var(--accent)"
            />
          </>
        )}
      </div>
    </div>
  );
}
