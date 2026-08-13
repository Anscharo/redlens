// Row + bucket rendering for the Stale Dates report, split out of
// StaleDatesReport.tsx so the page file stays data + <ReportShell>.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import type { DateClaim } from "../../lib/staleDates";
import { hiddenMatches, type ReportQuery } from "../../lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";
import { staleSearchFields } from "./staleDatesSearch";

function staleness(c: DateClaim): string {
  // The viewer's local day and the day the atlas text was written against can
  // differ by a day either way, so near the boundary hedge with "~1d" rather
  // than claiming "today".
  if (Math.abs(c.daysUntilStale) <= 1) return "(~1d)";
  if (c.daysUntilStale < 0) return `(${-c.daysUntilStale}d overdue)`;
  return `(in ${c.daysUntilStale}d)`;
}

function ClaimRow({ c, tone, rq }: { c: DateClaim; tone: string; rq: ReportQuery }) {
  // The tone lives on a left bar (the selected-node idiom) — --red on the
  // dark background is unreadable as small text, so the date stays tan.
  // The whole row is one link to the doc; the doc number renders as plain
  // text on the right (nested anchors are invalid HTML).
  return (
    <AtlasLink
      to={atlasHref(c.docId)}
      title={c.title}
      className="relative block py-4 px-3 border-b border-l-2 last:border-b-0 no-underline transition-colors hover:bg-[var(--hover)]"
      style={{ borderColor: "var(--border)", borderLeftColor: tone }}
    >
      <MatchAside matches={hiddenMatches(staleSearchFields(c), rq)} rq={rq} />
      <div className="flex items-baseline gap-6 flex-wrap">
        <span className="flex items-baseline gap-2">
          <span className="mono text-base font-semibold text-tan">
            <Highlight text={c.dateISO} rq={rq} />
          </span>
          <span className="mono text-base text-tan-2">{staleness(c)}</span>
        </span>
        <span className="text-lg text-tan">
          <Highlight text={c.title} rq={rq} />
        </span>
        {c.transition && (
          <span
            className="mono text-xs px-1.5 py-0.5 rounded"
            style={{ background: "var(--hover)", color: "var(--accent)" }}
            title="Operational control handoff — checked against the date the transition was estimated for"
          >
            handoff
          </span>
        )}
        <span className="mono text-xs text-accent ml-auto">
          <Highlight text={c.docNo} rq={rq} />
        </span>
      </div>
      <p className="text-sm mt-1 ml-4 text-tan-2" style={{ maxWidth: "95ch" }}>
        …<Highlight text={c.contextBefore} rq={rq} />
        <em>
          <Highlight text={c.raw} rq={rq} />
        </em>
        <Highlight text={c.contextAfter} rq={rq} />…
      </p>
    </AtlasLink>
  );
}

export function StaleDatesSection({
  title,
  hint,
  claims,
  tone,
  textTone,
  rq,
}: {
  title: string;
  hint: string;
  claims: readonly DateClaim[];
  tone: string;
  textTone?: string; // heading text when the bar tone is too dark to read on --bg
  rq: ReportQuery;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-0.5" style={{ color: textTone ?? tone }}>
        {title} <span className="mono text-base text-tan-3">({claims.length})</span>
      </h2>
      <p className="text-base text-tan-3 mb-2">{hint}</p>
      {claims.length === 0 ? (
        <p className="mono text-base text-tan-3">none</p>
      ) : (
        claims.map((c, i) => <ClaimRow key={`${c.docId}:${c.dateISO}:${i}`} c={c} tone={tone} rq={rq} />)
      )}
    </section>
  );
}
