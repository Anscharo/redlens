// Paging for the ranked tools (atlas_search, atlas_query): the largest page one
// call may ask for, how many candidates to fetch for it, and how a page that
// would outgrow the caller's budget is cut. Rows are dropped whole and
// `next_offset` says where the next page starts, so the chat transport's
// last-resort cut (applyChatToolBudget, which slices the JSON text mid-row)
// does not run on these tools.
import { z } from "zod";
import { fitToBudget, MAX_RESULT_CHARS } from "../chat/output-budget.ts";
import type { ToolCallContext } from "../chat/tools/tool-context.ts";

/** Rows one call may ask for. The budget usually binds first: a lean row is
 *  about 400 chars, so the 30k chat budget holds ~70 and a large read all 200. */
export const PAGE_K_MAX = 200;

export const pageShape = {
  k: z
    .number()
    .int()
    .min(1)
    .max(PAGE_K_MAX)
    .default(10)
    .describe("Rows to return. A page that would not fit this caller's result budget stops early and returns next_offset."),
  offset: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .default(0)
    .describe("Ranked rows to skip. Pass a previous result's next_offset, with the same k, to read the next page; no next_offset means this k has no further page."),
};

/** The whole-result budget for this caller: the chat transport's cut, which
 *  execToolDetailed passes down as `resultChars`, else the MCP budget. */
export function resultChars(ctx?: ToolCallContext): number {
  return ctx?.resultChars ?? MAX_RESULT_CHARS;
}

/** Candidates to fetch for rows [offset, offset + k). A fused ranking depends
 *  on how deep each leg was fetched, since RRF adds a term for every list a
 *  document is in, so its pool follows `k` alone: every page of one `k` reads
 *  the same ranking, and `next_offset` stops where it ends. 4× leaves room for
 *  the filters applied after the fetch. An exact lexical ranking is a prefix at
 *  any depth, so it fetches the window plus one row to tell whether more exist. */
export function poolSize(offset: number, k: number, exact: boolean): number {
  return exact ? offset + k + 1 : k * 4;
}

// Room kept for the envelope around the rows: counts, hints, the liveness hint.
const ENVELOPE_CHARS = 2_000;

/** The truncation hint for a listing that ignores `offset`, naming what does narrow it. */
export const unpagedHint = (narrowers: string) =>
  `Results truncated to fit context. This listing does not page with offset; narrow it with ${narrowers}.`;

export const PAGE_HINT =
  "This page stopped at the result budget before reaching k rows. Call again with offset set to next_offset for the rest, or narrow with a type or filter.";

/** Keeps a prefix of `rows` that fits `budget` together with the envelope and
 *  `extra(kept)` (atlas_query's ancestors map). `extra` of a prefix is never
 *  larger than of the whole, so one refit is enough. */
export function fitWithExtra<R>(rows: R[], budget: number, extra?: (kept: R[]) => unknown): { kept: R[]; truncated: boolean } {
  const room = Math.max(0, budget - ENVELOPE_CHARS);
  const fit = fitToBudget(rows, room);
  const x = extra?.(fit.kept);
  if (x == null) return fit;
  const refit = fitToBudget(fit.kept, Math.max(0, room - JSON.stringify(x).length));
  return { kept: refit.kept, truncated: fit.truncated || refit.truncated };
}

export interface PageFields {
  next_offset?: number;
  truncated?: true;
  hint?: string;
}

/** Rows [offset, offset + k) of `all`, built by `toRow` and cut whole to
 *  `budget`. `next_offset` is set whenever rows past this page exist;
 *  `truncated` only when the budget, not `k`, ended the page. */
export function pageOf<T, R>(
  all: T[],
  window: { offset: number; k: number },
  budget: number,
  toRow: (t: T) => R,
  extra?: (kept: R[]) => unknown,
): { rows: R[]; fields: PageFields } {
  const { offset, k } = window;
  const { kept, truncated } = fitWithExtra(all.slice(offset, offset + k).map(toRow), budget, extra);
  if (!truncated && all.length <= offset + k) return { rows: kept, fields: {} };
  return { rows: kept, fields: { next_offset: offset + kept.length, ...(truncated ? { truncated: true, hint: PAGE_HINT } : {}) } };
}
