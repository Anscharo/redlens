// Paging for the ranked tools (atlas_search, atlas_query): the largest page one
// call may ask for, how many candidates to fetch for it, and how a page that
// would outgrow the caller's budget is cut. Rows are dropped whole and
// `next_offset` says where the next page starts, so the chat transport's
// last-resort cut (applyChatToolBudget, which slices the JSON text mid-row)
// does not run on these tools.
import { z } from "zod";
import { fitToBudget } from "../chat/output-budget.ts";

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
  // No upper bound: next_offset may point anywhere in a long list, and a
  // deep offset costs nothing (MiniSearch scores every match before slicing).
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Ranked rows to skip. Pass a previous result's next_offset, with the same k, to read the next page."),
};

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

/** atlas_query's entity_broad hint, on a truncated listing or one asked for an
 *  `offset`: that listing ignores `offset`, so it names what does narrow it. */
export const UNPAGED_HINT =
  "This listing does not page with offset and always starts at its first row; narrow it with edge_types, target_type or a query.";

export const PAGE_HINT =
  "This page stopped at the result budget before reaching k rows. Call again with offset set to next_offset for the rest, or narrow with a type or filter.";

/** Keeps a prefix of `rows` that fits `budget` together with the envelope and
 *  `extra(kept)` (atlas_query's ancestors map), and returns that `extra`.
 *  `extra` of a prefix is never larger than of the whole, so one refit is enough. */
export function fitWithExtra<R>(rows: R[], budget: number, extra?: (kept: R[]) => unknown): { kept: R[]; truncated: boolean; extra: unknown } {
  const room = Math.max(0, budget - ENVELOPE_CHARS);
  const fit = fitToBudget(rows, room);
  const x = extra?.(fit.kept) ?? null;
  if (x === null) return { ...fit, extra: null };
  const refit = fitToBudget(fit.kept, Math.max(0, room - JSON.stringify(x).length));
  if (refit.kept.length === fit.kept.length) return { ...fit, extra: x };
  return { kept: refit.kept, truncated: true, extra: extra!(refit.kept) };
}

export interface PageFields {
  next_offset?: number;
  truncated?: true;
  /** The ranking stopped at its candidate pool, not at the last match. */
  ranking_cut?: true;
  hint?: string;
}

export interface PageOpts<R> {
  /** What the envelope derives from the kept rows; sized by fitWithExtra. */
  extra?: (kept: R[]) => unknown;
  /** A leg of the ranking filled its pool, so matches exist past `all`. */
  poolCut?: boolean;
}

/** Rows [offset, offset + k) of `all`, built by `toRow` and cut whole to
 *  `budget`. `next_offset` is set whenever rows past this page exist;
 *  `truncated` only when the budget, not `k`, ended the page. */
export function pageOf<T, R>(
  all: T[],
  window: { offset: number; k: number },
  budget: number,
  toRow: (t: T) => R,
  opts: PageOpts<R> = {},
): { rows: R[]; fields: PageFields; extra: unknown } {
  const { offset, k } = window;
  const { kept, truncated, extra } = fitWithExtra(all.slice(offset, offset + k).map(toRow), budget, opts.extra);
  if (!truncated && all.length <= offset + k) return { rows: kept, extra, fields: endFields(offset, k, all.length, !!opts.poolCut) };
  return { rows: kept, extra, fields: { next_offset: offset + kept.length, ...(truncated ? { truncated: true, hint: PAGE_HINT } : {}) } };
}

/** The paging fields of a page that reached the end of its ranking: whether
 *  that end is the pool's rather than the last match's, and an offset past it. */
function endFields(offset: number, k: number, total: number, poolCut: boolean): PageFields {
  const past = offset > 0 && offset >= total ? `offset ${offset} is past the end of this ranking, which holds ${total} rows at this k. ` : "";
  if (!poolCut) return past ? { hint: past.trim() } : {};
  const deeper = k < PAGE_K_MAX ? `call again with a larger k (up to ${PAGE_K_MAX}) to rank deeper` : "narrow with a type or filter";
  return { ranking_cut: true, hint: `${past}This ranking stopped at its candidate pool, not at the last match: ${deeper}.` };
}
