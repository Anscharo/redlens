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
