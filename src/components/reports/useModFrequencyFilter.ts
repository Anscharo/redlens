import { useState, useEffect, useCallback } from "react";
import { useUrlState, urlEnum, urlInt } from "../../hooks/useUrlState";
import { trackReportFilter } from "./useReportQuery";
import {
  matchesFrequency,
  FREQUENCY_COMPARATORS,
  FREQUENCY_MIN,
  FREQUENCY_MAX,
  FREQUENCY_DEFAULT,
  type FrequencyComparator,
} from "@/lib/modFrequencyIndex";
import type { ReportId } from "@/types";

const REPORT: ReportId = "mod-frequency";
const comparatorCodec = urlEnum<FrequencyComparator>("lte", FREQUENCY_COMPARATORS);
const thresholdCodec = urlInt(FREQUENCY_DEFAULT);

// Pill text bakes in the live threshold — "Least Frequent (≤1 edit)" reads as
// a preview of what the pill currently selects, not just a static label.
export function comparatorDisplay(threshold: number): Record<FrequencyComparator, string> {
  const edit = `edit${threshold === 1 ? "" : "s"}`;
  return {
    lte: `Least Frequent (≤${threshold} ${edit})`,
    gt: `Most Frequent (>${threshold} ${edit})`,
  };
}

/** The report's URL-synced ≤/> edit-count filter — one control shared by the
 *  Sum By tab's category percentages and the List tab's document list, so it
 *  lives page-level (above the tabs) in ModFrequencyReport, not per-tab. */
export function useModFrequencyFilter() {
  const [comparator, setComparator] = useUrlState("cmp", comparatorCodec);
  const [threshold, setThreshold] = useUrlState("n", thresholdCodec);
  // Local editing buffer so the field can be freely cleared/retyped — a
  // number input controlled directly by the clamped URL value fights the
  // user mid-edit (e.g. can't clear "1" to type "9"). Commits (clamped to
  // [FREQUENCY_MIN, FREQUENCY_MAX]) on blur/Enter; invalid or empty input
  // reverts to the last committed value.
  const [thresholdInput, setThresholdInput] = useState(String(threshold));
  useEffect(() => setThresholdInput(String(threshold)), [threshold]);

  const commitThreshold = (raw: string) => {
    const n = Number(raw);
    if (!raw || !Number.isFinite(n)) {
      setThresholdInput(String(threshold));
      return;
    }
    const clamped = Math.min(FREQUENCY_MAX, Math.max(FREQUENCY_MIN, Math.round(n)));
    setThreshold(clamped);
    setThresholdInput(String(clamped));
    trackReportFilter(REPORT, "threshold", clamped, clamped !== FREQUENCY_DEFAULT);
  };

  const onComparator = (c: FrequencyComparator) => {
    setComparator(c);
    trackReportFilter(REPORT, "comparator", c, c !== "lte");
  };

  const matchesFilter = useCallback((count: number) => matchesFrequency(count, comparator, threshold), [comparator, threshold]);
  const filterLabel = `${comparator === "lte" ? "≤" : ">"}${threshold} modification${threshold === 1 ? "" : "s"}`;
  // Every doc-level download already only ever contains threshold-matching
  // docs (rows are pre-filtered before export) — this just makes that
  // reflected in the button/filename once the threshold moves off its
  // default, so a saved CSV is traceable to the filter that produced it.
  const thresholdActive = comparator !== "lte" || threshold !== FREQUENCY_DEFAULT;

  return {
    comparator,
    threshold,
    thresholdInput,
    setThresholdInput,
    commitThreshold,
    onComparator,
    matchesFilter,
    filterLabel,
    thresholdActive,
  };
}
