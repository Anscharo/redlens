// Shared output-size guard. MCP clients have a bounded context window, so a
// single 300–600KB tool response overflows the very assistant that called it
// (observed on atlas_entity / atlas_entity_params for Prime Agents). Every
// tool that emits a content-bearing array runs it through fitToBudget, which
// greedily keeps items while the running serialized size stays under a byte
// budget, then reports `truncated` so the caller can page or narrow instead of
// blowing up. Budget counts chars of JSON (~1 byte each); tune via env.
export const MAX_RESULT_CHARS = Number(process.env.MCP_MAX_RESULT_CHARS ?? 200_000);

export const TRUNCATION_HINT =
  "Results truncated to fit context. Narrow with a type/filter or page with limit/offset (or fetch specific ids).";

// Keep items while cumulative JSON size stays under `budget`. Always keeps at
// least one item — a lone oversized item is more useful than an empty result.
export function fitToBudget<T>(items: T[], budget = MAX_RESULT_CHARS): { kept: T[]; truncated: boolean } {
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
