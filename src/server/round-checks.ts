// Deterministic per-round retrieval telemetry for the chat reliability harness
// (docs/plans/chat-reliability-harness.md). Pure code, zero model cost —
// accumulated across a turn via chat-loop's onRoundEnd, it feeds the advisor
// escalation gate ("retrieval trouble") and the verifier prompt's telemetry
// section. Model-based round digests are explicitly NOT v1.
import type { RoundInfo } from "./chat-loop.ts";

export interface RoundTelemetry {
  rounds: number;
  toolCalls: number;
  emptyResults: number; // tool ran fine but found nothing
  errorResults: number; // tool returned {"error": …}
  repeatedQueries: number; // near-duplicate re-issues of an earlier call (spinning)
  notes: string[]; // human-readable, one per flagged event — fed to verifier/advisor prompts
}

export function isErrorResult(content: string): boolean {
  return content.startsWith('{"error"');
}

// "Ran fine, found nothing": every array field is empty and no field carries a
// non-trivial scalar payload. Tool outputs are heterogeneous JSON, so this is a
// heuristic — biased toward false negatives (missing an empty) over false
// positives (flagging a real result), since it feeds an escalation trigger.
export function isEmptyResult(content: string): boolean {
  if (isErrorResult(content)) return false;
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch {
    return content.trim().length === 0;
  }
  if (obj == null) return true;
  if (Array.isArray(obj)) return obj.length === 0;
  if (typeof obj !== "object") return false;
  const values = Object.values(obj as Record<string, unknown>);
  const arrays = values.filter(Array.isArray);
  if (arrays.length === 0) return false;
  if (!arrays.every((a) => a.length === 0)) return false;
  // All arrays empty — treat long strings or nested objects as substance.
  return !values.some(
    (v) => (typeof v === "string" && v.length > 80) || (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0),
  );
}

// Canonical form of a call for duplicate detection: tool name + sorted args,
// lowercased, whitespace-collapsed. Catches both exact re-issues and trivial
// rephrasings ("Star Facilitator" vs "star facilitator").
export function normalizeCall(name: string, args: Record<string, unknown>): string {
  const sorted = Object.keys(args)
    .sort()
    .map((k) => `${k}=${JSON.stringify(args[k])}`)
    .join(",");
  return `${name}(${sorted})`.toLowerCase().replace(/\s+/g, " ");
}

export function createRoundChecker(): {
  record: (info: RoundInfo) => void;
  telemetry: () => RoundTelemetry;
} {
  const seen = new Set<string>();
  const t: RoundTelemetry = { rounds: 0, toolCalls: 0, emptyResults: 0, errorResults: 0, repeatedQueries: 0, notes: [] };

  return {
    record(info: RoundInfo): void {
      t.rounds = Math.max(t.rounds, info.iter + 1);
      for (const call of info.calls) {
        t.toolCalls++;
        const key = normalizeCall(call.name, call.args);
        if (seen.has(key)) {
          t.repeatedQueries++;
          t.notes.push(`round ${info.iter + 1}: repeated a near-identical call ${key.slice(0, 120)}`);
        }
        seen.add(key);
      }
      for (const r of info.results) {
        if (isErrorResult(r.content)) {
          t.errorResults++;
          t.notes.push(`round ${info.iter + 1}: ${r.name} returned an error`);
        } else if (isEmptyResult(r.content)) {
          t.emptyResults++;
          t.notes.push(`round ${info.iter + 1}: ${r.name} found nothing`);
        }
      }
    },
    telemetry: () => ({ ...t, notes: [...t.notes] }),
  };
}
