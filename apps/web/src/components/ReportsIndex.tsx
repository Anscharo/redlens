import { Link } from "./Link";
import { reportHref } from "@/lib/routes";
import { buildReportCatalog, type ReportCard } from "@/lib/reportCatalog";
import { track } from "../lib/analytics";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { ProvenanceBadge } from "./ProvenanceBadge";

// Thin renderer over src/lib/reportCatalog.ts, which owns the grouping, the
// provenance metadata, and the query filter. Groups are by SUBJECT (what a
// report is about, which is how people browse); provenance rides along as a
// per-card badge so neither axis has to distort the other.

function Card({ card }: { card: ReportCard }) {
  return (
    <Link
      to={reportHref(card.id)}
      className="w-full text-left px-4 py-4 rounded border transition-colors hover:bg-[var(--hover)] block no-underline"
      style={{ borderColor: "var(--border)" }}
      onClick={() => track("report_open", { report_id: card.id })}
    >
      <p className="text-sm font-medium mb-1 flex items-center gap-2 flex-wrap" style={{ color: "var(--tan)" }}>
        {card.title}
        <ProvenanceBadge provenance={card.provenance} />
      </p>
      <p className="text-xs" style={{ color: "var(--tan-3)" }}>
        {card.description}
      </p>
    </Link>
  );
}

export function ReportsIndex({ query }: { query: string }) {
  useDocumentTitle("Sky Atlas Reports");
  const groups = buildReportCatalog(query);

  return (
    <div className="px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">reports</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Reports
        </h1>
        <p className="text-xs mb-6" style={{ color: "var(--tan-3)" }}>
          Unlabelled reports are rebuilt from the Atlas every time you open them. A badge marks the
          ones that are not.
        </p>
        {groups.map((g) => (
          <section key={g.title} className="mb-8">
            <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-1 pb-1 border-b border-[var(--border)]">
              {g.title}
            </h2>
            <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
              {g.hint}
            </p>
            <div className="space-y-3">
              {g.cards.map((c) => (
                <Card key={c.id} card={c} />
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && (
          <p className="mono text-xs" style={{ color: "var(--tan-3)" }}>
            No reports match "{query}".
          </p>
        )}
      </div>
    </div>
  );
}
