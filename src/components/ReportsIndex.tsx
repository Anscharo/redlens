import { Link } from "./Link";
import { reportHref } from "../lib/routes";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import type { ReportId } from "../types";

const REPORTS: { id: ReportId; title: string; description: string }[] = [
  {
    id: "of-responsibilities",
    title: "Operational Facilitator Responsibilities",
    description:
      "Every Atlas section mandating action from an Operational Facilitator, grouped by duty type with per-agent filtering.",
  },
  {
    id: "gov-ops-responsibilities",
    title: "Operational GovOps Responsibilities",
    description:
      "Every Atlas section mandating action from an Operational or Core GovOps — role definitions, per-executor assignments, scattered duties, and Active Data they maintain as Responsible Party.",
  },
  {
    id: "active-data",
    title: "Active Data Index",
    description:
      "All Active Data sections, their Responsible Parties, edit processes, and agent assignments — with CSV export.",
  },
  {
    id: "rewards",
    title: "Integrator Reward Relationships",
    description:
      "Every Distribution Reward and Integration Boost instance each Prime Agent has invoked — reward codes, partner names, and on-chain reward addresses.",
  },
  {
    id: "oea-assessment",
    title: "OEA Task Assessment",
    description:
      "Every task the Operational Executor Agent performs, rated weak/mid/strong for definitional precision and for incentives/penalties — AI-drafted against a fixed rubric, human-reviewed, with per-task reasoning.",
  },
  {
    id: "stale-dates",
    title: "Stale Dates",
    description:
      "Future-tense claims checked against today \u2014 dates the atlas still phrases as upcoming but that have already passed, plus claims due within the next week.",
  },
  {
    id: "processes",
    title: "Atlas Processes",
    description:
      "The curated inventory of governance, settlement, lifecycle, and operational processes — title, doc number, step count, status, responsible party.",
  },
];

export function ReportsIndex({ query }: { query: string }) {
  useDocumentTitle("Sky Atlas Reports");
  const q = query.trim().toLowerCase();
  const visible = q
    ? REPORTS.filter(
        (r) => r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
      )
    : REPORTS;

  return (
    <div className="px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">reports</p>
        <h1 className="text-xl font-semibold mb-6" style={{ color: "var(--tan)" }}>
          Reports
        </h1>
        <div className="space-y-3">
          {visible.map((r) => (
            <Link
              key={r.id}
              to={reportHref(r.id)}
              className="w-full text-left px-4 py-4 rounded border transition-colors hover:bg-[var(--hover)] block no-underline"
              style={{ borderColor: "var(--border)" }}
            >
              <p className="text-sm font-medium mb-1" style={{ color: "var(--tan)" }}>
                {r.title}
              </p>
              <p className="text-xs" style={{ color: "var(--tan-3)" }}>
                {r.description}
              </p>
            </Link>
          ))}
          {visible.length === 0 && (
            <p className="mono text-xs" style={{ color: "var(--tan-3)" }}>
              No reports match "{query}".
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
