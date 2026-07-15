import { useEffect, useMemo } from "react";
import { useSearchParams } from "wouter";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import { HEADER_OFFSET } from "../../lib/layout";
import { useUrlState, urlBool, urlEnum, urlString } from "../../hooks/useUrlState";
import { track } from "../../lib/analytics";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { loadAtlas } from "../../lib/docs";
import {
  loadProcesses,
  buildProcessRows,
  indexByParentDocNo,
  getStepChildren,
  processRowsToCSV,
  type ProcessRow,
} from "../../lib/processesIndex";
import { useLoaded } from "../../hooks/useAtlasData";
import { useLocalIgnores } from "../../hooks/useLocalIgnores";
import { NodeContent } from "../NodeContent";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ProcessCurationPanel } from "./ProcessCurationPanel";
import { ProcessCurationBar } from "./ProcessCurationBar";
import type { LocalIgnore } from "../../lib/curationStore";
import type { AtlasNode } from "../../types";
import { filterRows, parseReportQuery, type ReportMode, type ReportQuery, type SearchField } from "../../lib/reportFilter";
import { FilterSummary } from "./FilterSummary";
import { NoRowsMatch } from "./NoRowsMatch";
import { Highlight } from "./Highlight";

// Header-box text filter: title + doc number. Category/status/shape are
// pill-owned and deliberately excluded.
const searchFields = (r: ProcessRow): SearchField[] => [
  { label: "title", value: r.title },
  { label: "doc no", value: r.docNo },
];

type StatusFilter = "all" | "active" | "deferred-stub";
type ShapeFilter = "all" | "child" | "inline";

const STATUS_VALUES = ["all", "active", "deferred-stub"] as const;
const SHAPE_VALUES = ["all", "child", "inline"] as const;
const statusCodec = urlEnum<StatusFilter>("all", STATUS_VALUES);
const shapeCodec = urlEnum<ShapeFilter>("all", SHAPE_VALUES);
const categoryCodec = urlString(null);
const ignoredCodec = urlBool(false);

const STATUS_STYLE: Record<ProcessRow["status"], string> = {
  active: "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-tan",
  "deferred-stub": "bg-[var(--hover)] text-tan-3",
};

function StatusPill({ s }: { s: ProcessRow["status"] }) {
  return <span className={`mono text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[s]}`}>{s}</span>;
}

function StepsCell({ count, shape }: { count: number | null; shape: ProcessRow["shape"] }) {
  if (count === null) {
    return (
      <span className="mono text-[10px] text-tan-3" title="step count not auto-detectable">
        —
      </span>
    );
  }
  return (
    <span className="mono text-[10px] text-tan-3">
      {count} {shape === "inline" ? "inline " : ""}step{count === 1 ? "" : "s"}
    </span>
  );
}

function ExpandedBody({
  node,
  steps,
  onNavigate,
  existing,
  onMark,
  onUnmark,
}: {
  node: AtlasNode;
  steps: AtlasNode[];
  onNavigate: (id: string) => void;
  existing: LocalIgnore | undefined;
  onMark: (uuid: string, reason: string) => void;
  onUnmark: (uuid: string) => void;
}) {
  const hasSteps = steps.length > 0;
  return (
    <div className="px-6 py-5 bg-[var(--bg)] border-l-2 border-[var(--accent)]">
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <NodeContent content={node.content} onNavigate={onNavigate} />
          {hasSteps && (
            <>
              <p className="mt-8 mb-4 text-xs mono text-tan-3 uppercase tracking-wider">
                {steps.length} step{steps.length === 1 ? "" : "s"}
              </p>
              <ol className="space-y-8 list-none pl-0">
                {steps.map((s, i) => (
                  <li key={s.id}>
                    <h3 className="text-base font-medium mb-3" style={{ color: "var(--tan)" }}>
                      <span className="mono text-tan-3 mr-2">{i + 1}.</span>
                      <AtlasLink to={atlasHref(s.id)} className="hover:underline text-left">
                        {s.title}
                      </AtlasLink>
                      <span className="ml-2 mono text-[10px] text-tan-3 font-normal" title={s.id}>
                        ({s.id.slice(0, 8)})
                      </span>
                    </h3>
                    <NodeContent content={s.content} onNavigate={onNavigate} />
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <aside className="w-full lg:w-56 lg:shrink-0">
          <ProcessCurationPanel
            uuid={node.id}
            existing={existing}
            onMark={onMark}
            onUnmark={onUnmark}
          />
        </aside>
      </div>
    </div>
  );
}

function Row({
  r,
  node,
  stepChildren,
  expanded,
  onToggle,
  onNavigate,
  existing,
  onMark,
  onUnmark,
  rq,
}: {
  r: ProcessRow;
  node: AtlasNode;
  stepChildren: AtlasNode[];
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (id: string) => void;
  existing: LocalIgnore | undefined;
  onMark: (uuid: string, reason: string) => void;
  onUnmark: (uuid: string) => void;
  rq: ReportQuery;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <>
      <tr
        id={r.uuid}
        onClick={onToggle}
        aria-expanded={expanded}
        style={{ scrollMarginTop: HEADER_OFFSET }}
        className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
      >
        <td className="py-2 px-3 align-top w-6 text-tan-3 mono text-[10px]" aria-hidden>
          {expanded ? "▾" : "▸"}
        </td>
        <td className="py-2 px-3 align-top">
          <AtlasLink
            to={atlasHref(r.uuid)}
            onClick={stop}
            className="mono text-xs text-accent hover:underline text-left"
          >
            <Highlight text={r.docNo} rq={rq} />
          </AtlasLink>
        </td>
        <td className="py-2 px-3 align-top">
          <AtlasLink
            to={atlasHref(r.uuid)}
            onClick={stop}
            className="text-sm text-tan hover:underline text-left"
          >
            <Highlight text={r.title} rq={rq} />
          </AtlasLink>
        </td>
        <td className="py-2 px-3 align-top">
          <StepsCell count={r.stepCount} shape={r.shape} />
        </td>
        <td className="py-2 px-3 align-top">
          <div className="flex items-center gap-1">
            <StatusPill s={r.status} />
            {existing && (
              <span
                className="mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-tan-3"
                title={`Marked locally: ${existing.reason}`}
              >
                ignored
              </span>
            )}
          </div>
        </td>
        <td className="py-2 px-3 align-top mono text-[10px] text-tan-3" title={r.uuid}>
          {r.uuid.slice(0, 8)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="p-0">
            <ExpandedBody
              node={node}
              steps={stepChildren}
              onNavigate={onNavigate}
              existing={existing}
              onMark={onMark}
              onUnmark={onUnmark}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export function ProcessesReport({ onNavigate, query, mode }: { onNavigate: (id: string) => void; query: string; mode: ReportMode }) {
  useDocumentTitle("Atlas Processes: Sky Atlas by Redline");
  const atlas = useLoaded(loadAtlas);
  const processes = useLoaded(loadProcesses);

  const [statusFilter, setStatusFilter] = useUrlState("status", statusCodec);
  const [shapeFilter, setShapeFilter] = useUrlState("shape", shapeCodec);
  const [categoryFilter, setCategoryFilter] = useUrlState("category", categoryCodec);
  const [showIgnored, setShowIgnored] = useUrlState("ignored", ignoredCodec);

  // URL is the source of truth for the expanded row. Bookmarkable + back/forward
  // navigation drives expansion via useSearchParams. The post-render useEffect
  // below scrolls the row into view on initial load and on toggle.
  const [searchParams, setSearchParams] = useSearchParams();
  const expandedUuid = searchParams.get("expanded");

  const { marks, byUuid: ignoresByUuid, mark, unmark, clear } = useLocalIgnores();
  const rq = useMemo(() => parseReportQuery(query, mode), [query, mode]);

  const childrenByParentDocNo = useMemo(
    () => (atlas ? indexByParentDocNo(atlas.docs) : new Map()),
    [atlas],
  );

  const rows = useMemo(() => {
    if (!atlas || !processes) return [];
    return buildProcessRows(atlas.docs, processes);
  }, [atlas, processes]);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);

  const filtered = useMemo(() => {
    const base = rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (shapeFilter !== "all" && r.shape !== shapeFilter) return false;
      if (categoryFilter && r.category !== categoryFilter) return false;
      if (!showIgnored && ignoresByUuid.has(r.uuid)) return false;
      return true;
    });
    return filterRows(base, rq, searchFields);
  }, [rows, statusFilter, shapeFilter, categoryFilter, showIgnored, ignoresByUuid, rq]);

  // The "full report" export ignores the pill/search filters but still honors
  // the ignored-rows gate (ignored candidates are excluded from the inventory
  // by curation, not by an ad-hoc filter).
  const fullRows = useMemo(
    () => rows.filter((r) => showIgnored || !ignoresByUuid.has(r.uuid)),
    [rows, showIgnored, ignoresByUuid],
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, ProcessRow[]>();
    for (const r of filtered) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.docNo.localeCompare(b.docNo, undefined, { numeric: true }));
    }
    return map;
  }, [filtered]);

  const loading = !atlas || !processes;

  // After rows render, scroll the expanded row into view. Handles both the
  // initial page-load case (when the row didn't exist yet for the browser's
  // own hash-anchor scroll) and subsequent toggles.
  useEffect(() => {
    if (loading || !expandedUuid) return;
    requestAnimationFrame(() => {
      document.getElementById(expandedUuid)?.scrollIntoView({
        behavior: "instant" as ScrollBehavior,
      });
    });
  }, [loading, expandedUuid]);

  const toggle = (uuid: string) => {
    const next = expandedUuid === uuid ? null : uuid;
    setSearchParams((prev) => {
      const np = new URLSearchParams(prev);
      if (next) np.set("expanded", next);
      else np.delete("expanded");
      return np;
    });
  };

  return (
    <div className="px-6 py-6">
      <div className="max-w-6xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Atlas Processes
        </h1>
        <p className="text-sm text-tan-3 mb-5">
          The curated inventory of governance, settlement, lifecycle, and operational processes —{" "}
          {rows.length} entries across {categories.length} categories. Maintained via the{" "}
          <code className="mono text-xs">processes-triage</code> skill on each atlas update. Click a row to expand.
        </p>

        <ProcessCurationBar
          marks={marks}
          onClear={clear}
          showIgnored={showIgnored}
          onToggleShowIgnored={() => {
            track("report_filter", { report: "processes", filter_type: "show_ignored", active: !showIgnored });
            setShowIgnored((v) => !v);
          }}
        />

        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-tan-3 mr-1">Category:</span>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => {
                  const active = categoryFilter !== c;
                  track("report_filter", { report: "processes", filter_type: "category", value: active ? c : null, active });
                  setCategoryFilter(categoryFilter === c ? null : c);
                }}
                data-active={categoryFilter === c ? "true" : undefined}
                className="scope-pill text-xs px-2 py-0.5 rounded"
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-tan-3 mr-1">Status:</span>
            {(["active", "deferred-stub"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  const active = statusFilter !== s;
                  track("report_filter", { report: "processes", filter_type: "status", value: active ? s : null, active });
                  setStatusFilter(statusFilter === s ? "all" : s);
                }}
                data-active={statusFilter === s ? "true" : undefined}
                className="scope-pill text-xs px-2 py-0.5 rounded"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-tan-3 mr-1">Shape:</span>
            {(["child", "inline"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  const active = shapeFilter !== s;
                  track("report_filter", { report: "processes", filter_type: "shape", value: active ? s : null, active });
                  setShapeFilter(shapeFilter === s ? "all" : s);
                }}
                data-active={shapeFilter === s ? "true" : undefined}
                className="scope-pill text-xs px-2 py-0.5 rounded"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <FilterSummary
          query={query}
          filters={[
            categoryFilter,
            statusFilter !== "all" && `status:${statusFilter}`,
            shapeFilter !== "all" && `shape:${shapeFilter}`,
          ]}
        />
        {!loading && (
          <div className="flex items-center justify-between gap-4 mb-4">
            <p className="mono text-xs text-tan-3">{filtered.length} processes</p>
            <DownloadCsvButton
              report="processes"
              filename="atlas-processes.csv"
              rowCount={filtered.length}
              build={() => processRowsToCSV(filtered)}
              fullRowCount={fullRows.length}
              buildFull={() => processRowsToCSV(fullRows)}
              query={query}
              filters={[
                categoryFilter,
                statusFilter !== "all" && statusFilter,
                shapeFilter !== "all" && shapeFilter,
              ]}
            />
          </div>
        )}

        {loading ? (
          <p className="text-sm text-tan-3">Loading…</p>
        ) : (
          [...byCategory.entries()].map(([category, list]) => (
            <div key={category} className="mb-8">
              <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">
                {category} <span className="text-tan-3">({list.length})</span>
              </h2>
              <table className="w-full text-left">
                <thead>
                  <tr className="text-xs mono text-tan-3">
                    <th className="py-1 px-3 font-normal w-6" />
                    <th className="py-1 px-3 font-normal w-32">Doc #</th>
                    <th className="py-1 px-3 font-normal">Title</th>
                    <th className="py-1 px-3 font-normal w-28">Steps</th>
                    <th className="py-1 px-3 font-normal w-28">Status</th>
                    <th className="py-1 px-3 font-normal w-20">UUID</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const node = atlas!.docs[r.uuid];
                    const stepChildren =
                      r.shape === "child" ? getStepChildren(node, childrenByParentDocNo) : [];
                    return (
                      <Row
                        key={r.uuid}
                        r={r}
                        node={node}
                        stepChildren={stepChildren}
                        expanded={expandedUuid === r.uuid}
                        onToggle={() => toggle(r.uuid)}
                        onNavigate={onNavigate}
                        existing={ignoresByUuid.get(r.uuid)}
                        onMark={mark}
                        onUnmark={unmark}
                        rq={rq}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))
        )}

        {!loading && filtered.length === 0 && <NoRowsMatch query={query} />}
      </div>
    </div>
  );
}
