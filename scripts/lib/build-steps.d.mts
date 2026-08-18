// Type declarations for the canonical build-chain declaration (build-steps.mjs),
// so server TypeScript (tsconfig.server.json) and the assertion test can import
// it. Runtime stays build-steps.mjs.
export interface BuildStep {
  /** Stable short id used by PROFILES. */
  id: string;
  /** Log/error label — script basename without extension (e.g. "build-graph"). */
  name: string;
  /** Repo-relative entry point, or null for tooling-binary steps (ts, vite). */
  script: string | null;
  /** package.json script name (e.g. "build:graph"). */
  pnpmScript: string;
  /** Default runner per package.json; null for the tooling-binary steps. */
  runner: "node" | "bun" | null;
}
export const STEPS: BuildStep[];
export const COMMUTES: [string, string][];
export const PROFILES: Record<string, string[]>;
export const GZIP_ARTIFACTS: string[];
export function stepById(id: string): BuildStep;
export function stepsFor(profile: string): BuildStep[];
