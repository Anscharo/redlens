import { Link } from "./Link";
import { reportHref, REPORT_TITLES } from "../lib/routes";
import { track } from "../lib/analytics";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import type { ReportId } from "../types";

// Titles come from REPORT_TITLES (shared with visit-history capture); cards carry
// only the id + description here.
type ReportCard = { id: ReportId; title: string; description: string };
const card = (id: ReportId, description: string): ReportCard => ({
  id,
  title: REPORT_TITLES[id],
  description,
});

const SECTIONS: { title: string; reports: ReportCard[] }[] = [
  {
    title: "OEA Reports",
    reports: [
      card(
        "of-responsibilities",
        "Every Atlas section mandating action from an Operational Facilitator, grouped by duty type with per-agent filtering.",
      ),
      card(
        "gov-ops-responsibilities",
        "Every Atlas section mandating action from an Operational or Core GovOps — role definitions, per-executor assignments, scattered duties, and Active Data they maintain as Responsible Party.",
      ),
      card(
        "oea-assessment",
        "Every task the Operational Executor Agent performs, rated weak/mid/strong for definitional precision and for incentives/penalties — AI-drafted against a fixed rubric, human-reviewed, with per-task reasoning.",
      ),
    ],
  },
  {
    title: "General Reports",
    reports: [
      card(
        "active-data",
        "All Active Data sections, their Responsible Parties, edit processes, and agent assignments — with CSV export.",
      ),
      card(
        "rewards",
        "Every Distribution Reward and Integration Boost instance each Prime Agent has invoked — reward codes, partner names, and on-chain reward addresses.",
      ),
      card(
        "risk-rules",
        "Every atlas paragraph defining a risk rule — peg maintenance, allocation risk, smart contract security — scored 1–5 for precision and weak/mid/strong for penalties and incentives, AI-drafted against a fixed rubric and human-reviewed.",
      ),
      card(
        "stale-dates",
        "Future-tense claims checked against today — dates the atlas still phrases as upcoming but that have already passed, plus claims due within the next week.",
      ),
      card(
        "mod-frequency",
        "Every atlas document ranked by how rarely its content has been edited — semantic edits only, never moves or renumbers — groupable by section or document type.",
      ),
      card(
        "processes",
        "The curated inventory of governance, settlement, lifecycle, and operational processes — title, doc number, step count, status, responsible party.",
      ),
      card(
        "crossview",
        "The Atlas as functional chunks: hierarchical weight maps of scopes, agent artifacts, and primitives, a cross-cutting concept catalog with its audit trail, and the glossary of defined terms.",
      ),
    ],
  },
];

export function ReportsIndex({ query }: { query: string }) {
  useDocumentTitle("Sky Atlas Reports");
  const q = query.trim().toLowerCase();
  const sections = SECTIONS.map((s) => ({
    ...s,
    reports: q
      ? s.reports.filter(
          (r) => r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
        )
      : s.reports,
  })).filter((s) => s.reports.length > 0);

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
              {s.title}
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
                    {r.title}
                  </p>
                  <p className="text-xs" style={{ color: "var(--tan-3)" }}>
                    {r.description}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ))}
        {sections.length === 0 && (
          <p className="mono text-xs" style={{ color: "var(--tan-3)" }}>
            No reports match "{query}".
          </p>
        )}
      </div>
    </div>
  );
}
