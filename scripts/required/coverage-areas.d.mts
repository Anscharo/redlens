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
