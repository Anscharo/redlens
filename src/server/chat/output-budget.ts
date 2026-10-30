import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config.ts";

// Shared output-size guard. MCP clients have a bounded context window, so a
// single 300–600KB tool response overflows the very assistant that called it
// (observed on atlas_entity / atlas_entity_params for Prime Agents). Every
// tool that emits a content-bearing array runs it through fitToBudget, which
// greedily keeps items while the running serialized size stays under a byte
// budget, then reports `truncated` so the caller can page or narrow instead of
// blowing up. Budget counts chars of JSON (~1 byte each); tune via env
// (MCP_MAX_RESULT_CHARS, parsed in config.ts).
export const MAX_RESULT_CHARS = config.mcpMaxResultChars;

export const TRUNCATION_HINT =
  "Results truncated to fit context. Narrow with a type/filter or page with limit/offset (or fetch specific ids).";

// The whole-result budget of the tool call in progress. invokeTool sets it from
// ToolCallContext.resultChars (the chat transport's cut), so every fitToBudget
// in a handler drops whole rows to the cut that call faces instead of leaving
// the transport to slice its JSON mid-row. Outside a call, and on MCP, it is
// MAX_RESULT_CHARS.
const callBudget = new AsyncLocalStorage<number>();

/** Runs `fn` with `chars` as the result budget of every fitToBudget inside it; undefined keeps the one in force. */
export function withResultBudget<T>(chars: number | undefined, fn: () => T): T {
  return chars === undefined ? fn() : callBudget.run(chars, fn);
}

/** The whole-result budget of the tool call in progress. */
export function resultBudget(): number {
  return callBudget.getStore() ?? MAX_RESULT_CHARS;
}

// Room kept for the envelope around the rows: counts, hints, the liveness hint.
export const ENVELOPE_CHARS = 2_000;

/** Chars left for a result's rows once the envelope and `beside` (the parts of
 *  the result that are not cut, serialized) are paid for. */
export function rowBudget(beside?: unknown): number {
  const taken = beside === undefined ? 0 : JSON.stringify(beside).length;
  return Math.max(0, resultBudget() - ENVELOPE_CHARS - taken);
}

// Keep items while cumulative JSON size stays under `budget`. Always keeps at
// least one item — a lone oversized item is more useful than an empty result.
export function fitToBudget<T>(items: T[], budget = rowBudget()): { kept: T[]; truncated: boolean } {
  const kept: T[] = [];
  let size = 0;
  for (const it of items) {
    const cost = JSON.stringify(it).length + 1;
    if (kept.length > 0 && size + cost > budget) return { kept, truncated: true };
    kept.push(it);
    size += cost;
  }
  return { kept, truncated: false };
}

/** Fits several lists of one result into one budget, in order: each list gets
 *  what the lists before it left. Only the first keeps a lone row past the
 *  budget (fitToBudget's floor); a later list with no room left keeps none, so
 *  together they stay under `budget` unless the first list's first row alone exceeds it. */
export function fitEachToBudget<T>(lists: T[][], budget = rowBudget()): { kept: T[]; truncated: boolean }[] {
  let left = budget;
  return lists.map((items, i) => {
    const noRoom = i > 0 && items.length > 0 && JSON.stringify(items[0]).length + 1 > left;
    const fit = noRoom ? { kept: [], truncated: true } : fitToBudget(items, left);
    left = Math.max(0, left - JSON.stringify(fit.kept).length);
    return fit;
  });
}
