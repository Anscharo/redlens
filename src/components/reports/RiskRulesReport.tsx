import { useEffect, useMemo, useRef, useTransition } from "react";
import { loadAtlas } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import { track } from "../../lib/analytics";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { enumerateRiskCandidates, RISK_DOMAIN_LABELS, type RiskDomain } from "../../lib/riskRules";
import type { Rating } from "../../lib/oeaAssessment";
import { loadRiskAssessment, joinRisk, summarizeRisk, type RiskJoin, type RiskRow, type RiskRowStatus } from "../../lib/riskAssessmentIndex";
import { CategoryPills, categoryCodec } from "./CategoryPills";
import { RiskTable } from "./RiskRulesTable";

const domainCodec = categoryCodec(RISK_DOMAIN_LABELS);
const SCORES = ["1", "2", "3", "4", "5"] as const;
type Score = (typeof SCORES)[number];
const scoreCodec = categoryCodec(Object.fromEntries(SCORES.map((s) => [s, s])) as Record<Score, string>);
const ratingCodec = categoryCodec<Rating>({ weak: "weak", mid: "mid", strong: "strong" });
const statusCodec = categoryCodec<RiskRowStatus>({ fresh: "fresh", stale: "stale", unassessed: "unassessed" });
const expandedCodec = urlString(null);
const RATINGS = ["weak", "mid", "strong"] as const;
const STATUSES = ["fresh", "stale", "unassessed"] as const;
// Allocation risk and smart contract security carry far more rows than peg
// maintenance — show them first.
const SECTION_ORDER: RiskDomain[] = ["alloc", "sc", "peg"];

function SummaryStrip({ join, shown }: { join: RiskJoin; shown: number }) {
  const s = summarizeRisk(join.rows);
  const p = ([1, 2, 3, 4, 5] as const).map((k) => `${s.preciseness[k]}×${k}`).join(" ");
  return (
    <p className="mono text-xs text-tan-3 mb-4">
      {shown} rules · preciseness: {p} · incentives: {s.enforcement.weak} weak · {s.enforcement.mid} mid · {s.enforcement.strong} strong
      {s.stale > 0 && ` · ${s.stale} stale`}
      {s.unassessed > 0 && ` · ${s.unassessed} unassessed`}
      {join.untriaged > 0 && ` · ${join.untriaged} awaiting triage`}
    </p>
  );
}

export function RiskRulesReport() {
  useDocumentTitle("Risk Rules Assessment: Sky Atlas by Redline");
  const atlas = useLoaded(loadAtlas);
  const artifact = useLoaded(loadRiskAssessment);
  const [domain, setDomain] = useUrlState("domain", domainCodec);
  const [score, setScore] = useUrlState("preciseness", scoreCodec);
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
      join.rows.filter(
        (r) =>
          (domain === null || r.triage.domains.includes(domain)) &&
          (status === null || r.status === status) &&
          (score === null || String(r.entry?.preciseness) === score) &&
          (enforce === null || r.entry?.enforcement === enforce),
      ),
    [join, domain, status, score, enforce],
  );
  const byDomain = useMemo(
    () => Object.groupBy(filtered, (r) => r.triage.domains[0] ?? r.candidate.domains[0]),
    [filtered],
  );

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
          preciseness and weak/mid/strong for penalties and incentives.
        </p>
        <p className="mono text-xs text-tan-3 mb-4" title="Ratings are LLM-drafted against the risk assessment rubric, then human-reviewed. Click a row for the reasoning.">
          ✳ assessed by {artifact?.assessModel ?? "—"} · human-reviewed · rubric {artifact?.rubricVersion ?? "—"}
        </p>

        {join.rows.length > 0 && <SummaryStrip join={join} shown={filtered.length} />}

        <div className="flex flex-wrap gap-4 mb-6">
          <CategoryPills label="Domain" categories={Object.keys(RISK_DOMAIN_LABELS) as RiskDomain[]} active={domain} onToggle={toggle("domain", domain, setDomain)} />
          <CategoryPills label="Preciseness" categories={SCORES} active={score} onToggle={toggle("preciseness", score, setScore)} />
          <CategoryPills label="Incentives" categories={RATINGS} active={enforce} onToggle={toggle("incentives", enforce, setEnforce)} />
          <CategoryPills label="Status" categories={STATUSES} active={status} onToggle={toggle("status", status, setStatus)} />
        </div>

        {atlas && SECTION_ORDER.map((d) => {
          const label = RISK_DOMAIN_LABELS[d];
          const rows = byDomain[d];
          if (!rows?.length) return null;
          return (
            <RiskTable key={d} label={label} rows={rows} docs={atlas.docs}
              expandedKey={expanded}
              onToggle={toggleRow} />
          );
        })}
      </div>
    </div>
  );
}
