// URL-synced filter state + analytics for the /reports/* pages. Every report
// filter is a URL param (shareable, back-button-safe) and every toggle emits
// ONE event shape:
//
//   report_filter { report, filter_kind, value, active }
//
// `filter_kind` is the dimension (chain, category, precision…), `value` is the
// resulting filter value — null when the click CLEARS the filter — and `active`
// says whether the dimension is now filtering. Reports used to split between
// `filter_type`/`value` and `filter_kind`/`slug`; routing every toggle through
// these hooks is what keeps that from drifting apart again.
import { useEffect, useMemo, useRef, useTransition } from "react";
import { track } from "../../lib/analytics";
import { useUrlState, urlEnum, urlEnumList, type UrlCodec } from "../../hooks/useUrlState";
import { parseReportQuery, type ReportMode, type ReportQuery } from "../../lib/reportFilter";

type Opts = { transition?: boolean };

/** Memoized parse of the header-box query — the row filter every report runs. */
export function useReportQuery(query: string, mode: ReportMode): ReportQuery {
  return useMemo(() => parseReportQuery(query, mode), [query, mode]);
}

/** The one `report_filter` emitter. Never call track("report_filter") directly. */
export function trackReportFilter(
  report: string,
  kind: string,
  value: string | number | null,
  active: boolean,
): void {
  track("report_filter", { report, filter_kind: kind, value, active });
}

/** `report_view`, once per mount, as soon as the page has data (`ready`).
 *  ReportShell calls this — pages don't. */
export function useReportView(report: string, ready: boolean, props?: Record<string, unknown>): void {
  const fired = useRef(false);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    if (!ready || fired.current) return;
    fired.current = true;
    track("report_view", { report, ...latest.current });
  }, [ready, report]);
}

// Wrapping a filter change in a transition keeps a big list responsive while
// it re-renders (RiskRules); the default applies the change synchronously.
function useApply(opts?: Opts) {
  const [, startTransition] = useTransition();
  return opts?.transition ? startTransition : (fn: () => void) => fn();
}

/** Single-select filter in its own param; clicking the active pill clears it. */
export function useReportFilter<T extends string>(
  report: string,
  param: string,
  codec: UrlCodec<T | null>,
  kind: string = param,
  opts?: Opts,
): readonly [T | null, (next: T) => void] {
  const [value, set] = useUrlState<T | null>(param, codec);
  const apply = useApply(opts);
  const toggle = (next: T) => {
    const active = value !== next;
    trackReportFilter(report, kind, active ? next : null, active);
    apply(() => set((cur) => (cur === next ? null : next)));
  };
  return [value, toggle] as const;
}

/** Enum filter with a non-null default ("all", …); re-clicking resets to it. */
export function useReportEnum<T extends string>(
  report: string,
  param: string,
  def: T,
  values: readonly T[],
  kind: string = param,
  opts?: Opts,
): readonly [T, (next: T) => void] {
  const codec = useMemo(() => urlEnum<T>(def, values), [def, values]);
  const [value, set] = useUrlState<T>(param, codec);
  const apply = useApply(opts);
  const toggle = (next: T) => {
    const active = value !== next;
    trackReportFilter(report, kind, active ? next : null, active);
    apply(() => set((cur) => (cur === next ? def : next)));
  };
  return [value, toggle] as const;
}

/** Exclusive choice (tab, grouping): always selects, never toggles back off.
 *  `active` reports whether the choice differs from the default. */
export function useReportSelect<T extends string>(
  report: string,
  param: string,
  def: T,
  values: readonly T[],
  kind: string = param,
): readonly [T, (next: T) => void] {
  const codec = useMemo(() => urlEnum<T>(def, values), [def, values]);
  const [value, set] = useUrlState<T>(param, codec);
  const select = (next: T) => {
    set(next);
    trackReportFilter(report, kind, next, next !== def);
  };
  return [value, select] as const;
}

/** Multi-select filter (comma-separated param); each click toggles one member. */
export function useReportList<T extends string>(
  report: string,
  param: string,
  values: readonly T[],
  kind: string = param,
  opts?: Opts,
): readonly [T[], (next: T) => void] {
  const codec = useMemo(() => urlEnumList<T>(values), [values]);
  const [list, set] = useUrlState<T[]>(param, codec);
  const apply = useApply(opts);
  const toggle = (next: T) => {
    const active = !list.includes(next);
    trackReportFilter(report, kind, active ? next : null, active);
    apply(() => set((cur) => (cur.includes(next) ? cur.filter((v) => v !== next) : [...cur, next])));
  };
  return [list, toggle] as const;
}

/** Boolean switch (a "show X" checkbox-style pill). */
export function useReportSwitch(
  report: string,
  param: string,
  codec: UrlCodec<boolean>,
  kind: string = param,
): readonly [boolean, () => void] {
  const [on, set] = useUrlState<boolean>(param, codec);
  const toggle = () => {
    trackReportFilter(report, kind, null, !on);
    set((cur) => !cur);
  };
  return [on, toggle] as const;
}
