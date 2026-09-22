// Report file shape + aggregation for the tool-choice eval, shared by the
// runner (eval-tools.ts) and the A/B gate (eval-tools-compare.ts). Errored runs
// (timeouts, transport failures) are counted but never scored: a resumed run
// re-tries them, and a pass rate over a flaky provider would measure the
// provider.
import fs from "node:fs";
import path from "node:path";
import type { Arm, RunRecord } from "./eval-tools-run.ts";

export const ROOT = path.resolve(import.meta.dir, "../..");
export const reportPath = (label: string) => path.join(ROOT, ".cache", `eval-tools.${label}.json`);

export interface CaseMeta {
  id: string;
  category: string;
  acceptFirst: string[];
  acceptFirstAfterDocFacts?: string[];
  acceptAny?: string[];
  forbid?: string[];
}

export interface ToolEvalReport {
  label: string;
  ranAt: string;
  atlasCommit: string | null;
  /** What was under test — an A/B is only meaningful when these are the ones that changed. */
  provenance: { toolsSha: string; promptSha: string; models: Record<string, string[]>; prefetchJudge: string; judgeDeadlineMs: number };
  passes: number;
  arms: Arm[];
  cases: CaseMeta[];
  runs: RunRecord[];
}

export function loadReport(label: string): ToolEvalReport {
  const p = fs.existsSync(label) ? label : reportPath(label);
  return JSON.parse(fs.readFileSync(p, "utf8")) as ToolEvalReport;
}

export const scored = (runs: RunRecord[]) => runs.filter((r) => !r.error && r.score);

export interface CaseRow {
  id: string;
  arm: Arm;
  n: number;
  first: number;
  all: number;
  /** First-round call sets seen, e.g. "atlas_query" / "(none)" / "atlas_get+atlas_query". */
  firstCalls: Record<string, number>;
}

export function caseRows(rep: ToolEvalReport): CaseRow[] {
  const rows: CaseRow[] = [];
  for (const arm of rep.arms) {
    for (const c of rep.cases) {
      const rs = scored(rep.runs.filter((r) => r.arm === arm && r.id === c.id));
      const firstCalls: Record<string, number> = {};
      for (const r of rs) {
        const k = r.score!.firstCalls.length ? [...r.score!.firstCalls].sort().join("+") : "(none)";
        firstCalls[k] = (firstCalls[k] ?? 0) + 1;
      }
      rows.push({ id: c.id, arm, n: rs.length, first: rs.filter((r) => r.score!.firstOk).length, all: rs.filter((r) => r.score!.allOk).length, firstCalls });
    }
  }
  return rows;
}

export interface ArmTotals {
  arm: Arm;
  runs: number;
  errors: number;
  n: number;
  firstRate: number;
  allRate: number;
  meanRequests: number;
  meanCalls: number;
  callErrorRate: number;
  emptyRate: number;
  emptyByFilters: number;
  forbidden: number;
  aqCalls: number;
  /** Share of atlas_query calls setting ≥1 param outside the case's allowance to a filtering value. */
  aqEffectiveRate: number;
  /** Share setting ≥1 such param at all, empty values included (the "fill every field" shape). */
  aqPresentRate: number;
  aqParams: Record<string, number>;
  fallbackServed: number;
  jevMissed: number;
  routedStrong: number;
  meanLatencyS: number;
  costUsd: number;
  jevCostUsd: number;
  subagentTokens: number;
}

// OpenRouter may report a dated/variant slug for the requested one (…-it vs …-it-20260101).
const samePrimary = (served: string, primary: string) => served.startsWith(primary) || primary.startsWith(served);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const ratio = (a: number, b: number) => (b ? a / b : 0);

export function armTotals(rep: ToolEvalReport, arm: Arm): ArmTotals {
  const all = rep.runs.filter((r) => r.arm === arm);
  const rs = scored(all);
  const calls = rs.flatMap((r) => r.calls);
  const extras = rs.flatMap((r) => r.score!.aqExtra);
  const aqParams: Record<string, number> = {};
  for (const e of extras) for (const p of e.effective) aqParams[p] = (aqParams[p] ?? 0) + 1;
  // A reused record is the routed run itself: spend counts once, on the routed arm.
  const paid = all.filter((r) => !r.reusedFrom);
  return {
    arm, runs: all.length, errors: all.length - rs.length, n: rs.length,
    firstRate: ratio(rs.filter((r) => r.score!.firstOk).length, rs.length),
    allRate: ratio(rs.filter((r) => r.score!.allOk).length, rs.length),
    meanRequests: mean(rs.map((r) => r.requests)),
    meanCalls: mean(rs.map((r) => r.score!.toolCalls)),
    callErrorRate: ratio(calls.filter((c) => !c.ok).length, calls.length),
    emptyRate: ratio(calls.filter((c) => c.empty).length, calls.length),
    emptyByFilters: calls.filter((c) => c.emptyByFilters).length,
    forbidden: rs.filter((r) => r.score!.forbiddenCalled.length > 0).length,
    aqCalls: extras.length,
    aqEffectiveRate: ratio(extras.filter((e) => e.effective.length > 0).length, extras.length),
    aqPresentRate: ratio(extras.filter((e) => e.present.length > 0).length, extras.length),
    aqParams,
    fallbackServed: rs.filter((r) => r.servedModels.some((m) => !samePrimary(m, r.models[0] ?? ""))).length,
    jevMissed: rs.filter((r) => !r.jev.landed).length,
    routedStrong: rs.filter((r) => r.routed.tier === "strong").length,
    meanLatencyS: mean(rs.map((r) => r.latencyMs)) / 1000,
    costUsd: paid.reduce((s, r) => s + r.costUsd, 0),
    jevCostUsd: paid.reduce((s, r) => s + (r.jev.costUsd ?? 0), 0),
    subagentTokens: paid.reduce((s, r) => s + r.subagentTokens, 0),
  };
}

export interface AqModelRow {
  model: string;
  runs: number;
  aqCalls: number;
  effectiveRate: number;
  presentRate: number;
  emptiedByFilters: number;
  params: Record<string, number>;
}

/** The atlas_query extra-param numbers split by the model(s) OpenRouter
 *  actually served each run (servedModels) — the routed arm mixes tiers, and a
 *  fallback that answered for the primary is its own row. */
export function aqByServedModel(rep: ToolEvalReport, arm: Arm): AqModelRow[] {
  const groups = new Map<string, RunRecord[]>();
  for (const r of scored(rep.runs.filter((x) => x.arm === arm))) {
    const k = r.servedModels.join("+") || "(none)";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups].map(([model, rs]) => {
    const extras = rs.flatMap((r) => r.score!.aqExtra);
    const params: Record<string, number> = {};
    for (const e of extras) for (const p of e.effective) params[p] = (params[p] ?? 0) + 1;
    return {
      model, runs: rs.length, aqCalls: extras.length,
      effectiveRate: ratio(extras.filter((e) => e.effective.length > 0).length, extras.length),
      presentRate: ratio(extras.filter((e) => e.present.length > 0).length, extras.length),
      emptiedByFilters: rs.flatMap((r) => r.calls).filter((c) => c.emptyByFilters).length,
      params,
    };
  }).sort((a, b) => b.runs - a.runs);
}

export const pct = (x: number) => `${(100 * x).toFixed(0)}%`;

export function printTable(rows: Record<string, unknown>[], cols: string[]): void {
  const w = (c: string) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)) + 2;
  const widths = cols.map(w);
  console.log(cols.map((c, i) => c.padEnd(widths[i])).join(""));
  for (const r of rows) console.log(cols.map((c, i) => String(r[c] ?? "").padEnd(widths[i])).join(""));
}
