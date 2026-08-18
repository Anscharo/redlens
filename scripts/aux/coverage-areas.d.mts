// Type surface for the exported helpers of coverage-areas.mjs (the CLI body is
// guarded behind isMain and not typed). Consumed by scripts_tests/coverage-areas.test.ts.
export interface CoverageArea {
  id: string;
  label: string;
  match: RegExp[];
}
export const areas: CoverageArea[];
export const reactAreaIds: string[];
export const backendAreaIds: string[];
export const libAreaIds: string[];
export function areaFor(file: string): string;
/** Whether a repo-relative file's 1-indexed line counts toward a coverage meter. */
export function isLogicLine(file: string, lineNo: number): boolean;
/**
 * Whether a set of changed lines clears the changed-code gate: the minimum
 * percentage, or at most `grace` uncovered changed lines. Defaults come from
 * COVERAGE_CHANGED_MIN / COVERAGE_CHANGED_GRACE.
 */
export function meetsChangedMin(changedCovered: number, changedTotal: number, min?: number, grace?: number): boolean;
/**
 * Merge per-runner LCOV reports (file → line → hits). For multi-runner files,
 * the runner with the greatest total hits defines the executable line set;
 * hits sum across runners over that set only.
 */
export function mergeLcovReports(reports: Array<Map<string, Map<number, number>>>): Map<string, Map<number, number>>;
