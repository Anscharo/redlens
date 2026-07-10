import { useEffect, useMemo, useRef, useTransition } from "react";
import { loadAtlas } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUrlState, urlString, type UrlCodec } from "../../hooks/useUrlState";
import { track } from "../../lib/analytics";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { enumerateRiskCandidates, RISK_DOMAIN_LABELS, type RiskDomain } from "../../lib/riskRules";
import type { Rating } from "../../lib/oeaAssessment";
import { loadRiskAssessment, joinRisk, summarizeRisk, type RiskJoin, type RiskRow, type RiskRowStatus } from "../../lib/riskAssessmentIndex";
import { CategoryPills, categoryCodec } from "./CategoryPills";
import { RiskTable } from "./RiskRulesTable";
import { Link } from "../Link";
import { ROUTES } from "../../lib/routes";
import { buildHaystack, filterRows } from "../../lib/reportFilter";
import { NoRowsMatch } from "./NoRowsMatch";

// Header-box text filter: title, doc number, the rated paragraph, and agent
// names. Domain/precision/incentives/status are pill-owned and excluded; the
// text filter ANDs with the pills.
const searchText = (r: RiskRow) =>
  buildHaystack([
    r.candidate.title, r.candidate.docNo, r.candidate.quote,
    ...(r.candidate.agents ?? []),
  ]);

// Multi-select: comma-separated in the URL, empty array = no filter.
const domainsCodec: UrlCodec<RiskDomain[]> = {
  encode: (v) => (v.length ? v.join(",") : null),
  decode: (raw) =>
    raw ? raw.split(",").filter((d): d is RiskDomain => d in RISK_DOMAIN_LABELS) : [],
};
const SCORES = ["1", "2", "3", "4", "5"] as const;
type Score = (typeof SCORES)[number];
const scoreCodec = categoryCodec(Object.fromEntries(SCORES.map((s) => [s, s])) as Record<Score, string>);
const ratingCodec = categoryCodec<Rating>({ weak: "weak", mid: "mid", strong: "strong" });
const statusCodec = categoryCodec<RiskRowStatus>({ fresh: "fresh", stale: "stale", unassessed: "unassessed" });
const expandedCodec = urlString(null);
const RATINGS = ["weak", "mid", "strong"] as const;
const STATUSES = ["fresh", "stale", "unassessed"] as const;

function SummaryStrip({ join, shown }: { join: RiskJoin; shown: number }) {
  const total = join.rows.length;
  return (
    <p className="mono text-xs text-tan-3 mb-4">
      {shown === total ? (
        `${total.toLocaleString()} Atlas sections match the filter`
      ) : (
        <>
          <strong className="font-semibold text-tan">{shown.toLocaleString()}</strong>
          {` of ${total.toLocaleString()} Atlas sections match the filter`}
        </>
      )}
      {join.untriaged > 0 && ` · ${join.untriaged} awaiting triage`}
    </p>
  );
}

export function RiskRulesReport({ query }: { query: string }) {
  useDocumentTitle("Risk Rules Assessment: Sky Atlas by Redline");
  const atlas = useLoaded(loadAtlas);
  const artifact = useLoaded(loadRiskAssessment);
  const [domains, setDomains] = useUrlState("domain", domainsCodec);
  const [score, setScore] = useUrlState("precision", scoreCodec);
  const [enforce, setEnforce] = useUrlState("incentives", ratingCodec);
  const [status, setStatus] = useUrlState("status", statusCodec);
  const [expanded, setExpanded] = useUrlState("expanded", expandedCodec);
  const trackedView = useRef(false);

  const join = useMemo<RiskJoin>(() => {
    if (!atlas) return { rows: [], untriaged: 0, rejected: 0 };
    return joinRisk(enumerateRiskCandidates(atlas).candidates, artifact);
  }, [atlas, artifact]);

  useEffect(() => {
    if (!artifact || join.rows.length === 0 || trackedView.current) return;
    trackedView.current = true;
    const summary = summarizeRisk(join.rows);
    track("report_view", {
      report: "risk-rules",
      row_count: join.rows.length,
      stale_count: summary.stale,
      unassessed_count: summary.unassessed,
      untriaged_count: join.untriaged,
      rubric_version: artifact.rubricVersion,
    });
  }, [artifact, join]);

  const [, startTransition] = useTransition();
  const toggle = <T extends string>(kind: string, current: T | null, set: (fn: (cur: T | null) => T | null) => void) =>
    (next: T) => {
      track("report_filter", { report: "risk-rules", filter_kind: kind, slug: next, active: current !== next });
      startTransition(() => set((cur) => (cur === next ? null : next)));
    };

  const toggleDomain = (d: RiskDomain) => {
    track("report_filter", { report: "risk-rules", filter_kind: "domain", slug: d, active: !domains.includes(d) });
    startTransition(() =>
      setDomains((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d])),
    );
  };

  const toggleRow = (row: RiskRow) => {
    const action = expanded === row.candidate.taskKey ? "collapse" : "expand";
    track("report_row_toggle", {
      report: "risk-rules",
      action,
      task_key: row.candidate.taskKey,
      node_id: row.candidate.uuid,
      domain: row.triage.domains[0] ?? row.candidate.domains[0] ?? null,
      status: row.status,
    });
    setExpanded((cur) => (cur === row.candidate.taskKey ? null : row.candidate.taskKey));
  };

  // Memoized so the row list only recomputes when a filter actually changes
  // (not on unrelated re-renders, e.g. expanding a row) — RiskTable's
  // pagination relies on `rows` keeping a stable identity across those.
  const filtered = useMemo(
    () =>
      [...filterRows(
        join.rows.filter(
          (r) =>
            (domains.length === 0 || domains.some((d) => r.triage.domains.includes(d))) &&
            (status === null || r.status === status) &&
            (score === null || String(r.entry?.preciseness) === score) &&
            (enforce === null || r.entry?.enforcement === enforce),
        ),
        query,
        searchText,
      )],
    [join, domains, status, score, enforce, query],
  );
  // Pill counts describe the unfiltered universe so they don't jump around
  // while filtering. Domain counts use the same any-tag matching as the filter
  // (rows carry multiple domains, so these overlap and sum to > total).
  const counts = useMemo(() => {
    const s = summarizeRisk(join.rows);
    const domain: Record<RiskDomain, number> = { peg: 0, alloc: 0, sc: 0 };
    for (const r of join.rows) for (const d of r.triage.domains) domain[d as RiskDomain]++;
    return {
      domain,
      score: Object.fromEntries(SCORES.map((k) => [k, s.preciseness[Number(k) as 1 | 2 | 3 | 4 | 5]])) as Record<Score, number>,
      enforce: s.enforcement,
      status: { fresh: join.rows.length - s.stale - s.unassessed, stale: s.stale, unassessed: s.unassessed },
    };
  }, [join]);

  return (
    <div className="px-6 py-6">
      <div className="max-w-5xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Risk Rules Assessment
        </h1>
        <p className="text-sm text-tan-3 mb-1">
          Every atlas paragraph that defines a risk-management rule, parameter, or process —
          peg maintenance, allocation risk, and smart contract security — scored 1–5 for
          precision and weak/mid/strong for penalties and incentives.
        </p>
        <p className="mono text-xs text-tan-3 mb-4" title="Ratings are LLM-drafted against the risk assessment rubric, then human-reviewed. Click a row for the reasoning.">
          ✳ assessed by {artifact?.assessModel ?? "—"} · human-reviewed ·{" "}
          <Link to={ROUTES.REPORTS_RISK_RUBRIC} className="text-accent hover:underline">
            rubric {artifact?.rubricVersion ?? "—"}
          </Link>
        </p>

        {join.rows.length > 0 && <SummaryStrip join={join} shown={filtered.length} />}

        <div className="flex flex-col gap-2 mb-6">
          <CategoryPills label="Risk Type" labelTitle="Broad category of risk assessment" categories={Object.keys(RISK_DOMAIN_LABELS) as RiskDomain[]} active={domains} onToggle={toggleDomain} display={RISK_DOMAIN_LABELS} counts={counts.domain} hint="multi-select" />
          <CategoryPills label="Precision" labelTitle="How clearly does this section describe a risk-related rule?" categories={SCORES} active={score} onToggle={toggle("precision", score, setScore)} counts={counts.score} hint="1 vague → 5 precise" />
          <CategoryPills label="Incentives" labelTitle="Does this section include a consequence or predetermined action?" categories={RATINGS} active={enforce} onToggle={toggle("incentives", enforce, setEnforce)} counts={counts.enforce} />
          <CategoryPills label="Status" labelTitle="Has this section been updated since the report was last refreshed?" categories={STATUSES} active={status} onToggle={toggle("status", status, setStatus)} counts={counts.status} />
        </div>

        {join.rows.length > 0 && filtered.length === 0 && <NoRowsMatch query={query} />}
        {atlas && filtered.length > 0 && (
          <RiskTable rows={filtered} docs={atlas.docs} expandedKey={expanded} onToggle={toggleRow} />
        )}
      </div>
    </div>
  );
}
