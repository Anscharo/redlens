import type { SourceSize } from "./size-metrics.mjs";

export interface Limit {
  warn: number;
  fail: number;
}

export const LIMITS: { file: Limit; fn: Limit; componentFactor: number };

export function inSizeScope(path: string): boolean;

export interface SizeFinding {
  key: string;
  kind: "file" | "fn" | "gone";
  path: string;
  name?: string;
  line: number;
  lines?: number;
  limit?: Limit;
  base?: number;
  level: "error" | "warn" | "stale";
  reason: "new" | "grew" | "shrank" | "fixed" | "gone" | "warn";
}

export type Baseline = Record<string, number>;

export function ratchet(
  measurements: Map<string, SourceSize>,
  baseline: Baseline,
  changed?: Set<string> | null,
): { findings: SizeFinding[]; tightened: Baseline; accepted: Baseline };

export function describe(finding: SizeFinding): string;
