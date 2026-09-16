import { Link } from "./Link";
import { reportHref } from "@/lib/routes";
import { parseReportQuery } from "@/lib/reportFilter";
import { track } from "../lib/analytics";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useReportIndexSearch } from "../hooks/useReportIndexSearch";
import { Highlight } from "./reports/Highlight";

export function ReportsIndex({ query }: { query: string }) {
  useDocumentTitle("Sky Atlas Reports");
  const { sections, pending } = useReportIndexSearch(query);
  const rq = parseReportQuery(query);

  return (
    <div className="px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">reports</p>
        <h1 className="text-xl font-semibold mb-6" style={{ color: "var(--tan)" }}>
          Reports
        </h1>
        {sections.map((s) => (
          <section key={s.title} className="mb-8">
            <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">
              <Highlight text={s.title} rq={rq} />
            </h2>
            <div className="space-y-3">
              {s.reports.map((r) => (
                <Link
                  key={r.id}
                  to={reportHref(r.id)}
                  className="w-full text-left px-4 py-4 rounded border transition-colors hover:bg-[var(--hover)] block no-underline"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => track("report_open", { report_id: r.id })}
                >
                  <p className="text-sm font-medium mb-1" style={{ color: "var(--tan)" }}>
                    <Highlight text={r.title} rq={rq} />
                  </p>
                  <p className="text-xs" style={{ color: "var(--tan-3)" }}>
                    <Highlight text={r.description} rq={rq} />
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ))}
        {sections.length === 0 && (
          <p className="mono text-xs" style={{ color: "var(--tan-3)" }}>
            {pending ? "Searching…" : `No reports match "${query}".`}
          </p>
        )}
      </div>
    </div>
  );
}
