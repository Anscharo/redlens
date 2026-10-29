// Large reads: how much of a `largeResult` tool's output one chat turn may
// read. Every other tool result stays under config.chatToolResultMaxChars.
// The settings and the reason for each limit are in config.ts.
import { config } from "../config.ts";

/** Per-turn state. `left` shrinks as large results are returned. */
export interface LargeRead {
  left: number;
  perResult: number;
}

/** The turn's large-read state, or null when any model in the chain has a
 *  small window: a failover sends the same context to the next model. */
export function largeReadFor(models: string[]): LargeRead | null {
  const large = new Set(config.chatLargeContextModels);
  if (!models.length || !models.every((m) => large.has(m))) return null;
  if (config.chatLargeReadMaxChars <= 0 || config.chatLargeResultMaxChars <= 0) return null;
  return { left: config.chatLargeReadMaxChars, perResult: config.chatLargeResultMaxChars };
}

/** Budget for one result. Falls back to the ordinary chat budget once the
 *  turn's large total is spent, so a turn never stops reading altogether. */
export function resultBudget(largeResult: boolean | undefined, read: LargeRead | null | undefined): number {
  if (!largeResult || !read || read.left <= config.chatToolResultMaxChars) return config.chatToolResultMaxChars;
  return Math.min(read.perResult, read.left);
}

/** One result's budget and the part of the turn's total set aside for it. */
export interface LargeGrant {
  chars: number;
  taken: number;
}

/** Grants one result its budget and takes that from the turn's total at once,
 *  so the calls of one round, which run in parallel (runToolRound), cannot each
 *  be granted the whole remainder. settleLargeRead returns what went unused. */
export function reserveLargeRead(largeResult: boolean | undefined, read: LargeRead | null | undefined): LargeGrant {
  const chars = resultBudget(largeResult, read);
  if (!largeResult || !read) return { chars, taken: 0 };
  const taken = Math.min(chars, read.left);
  read.left -= taken;
  return { chars, taken };
}

/** Gives back the part of a grant the returned result did not use. */
export function settleLargeRead(read: LargeRead | null | undefined, grant: LargeGrant, used: number): void {
  if (read) read.left += Math.max(0, grant.taken - used);
}

/** Preview-tool page sizes. The large ones apply only to a result granted more
 *  than the ordinary budget (`resultChars`, from reserveLargeRead). Every other
 *  caller, MCP included, keeps the small ones, because the preview tools have
 *  no other bound on their output. */
export interface PreviewCaps {
  limit: number;
  patchLines: number;
  ids: number;
}
const SMALL_CAPS: PreviewCaps = { limit: 100, patchLines: 40, ids: 5 };
const LARGE_CAPS: PreviewCaps = { limit: 1000, patchLines: 400, ids: 50 };

export function previewCaps(resultChars: number | undefined): PreviewCaps {
  return resultChars !== undefined && resultChars > config.chatToolResultMaxChars ? LARGE_CAPS : SMALL_CAPS;
}

/** The system-prompt line that tells the model it may ask for large pages. */
export const LARGE_READ_PROMPT =
  "This turn can read large results. atlas_search (hybrid or lexical) and atlas_query return up to 200 rows a call (`k`), so a question " +
  "about a whole class of documents can read all of it in one call. To review a PR, call atlas_preview_diff with a high `limit` (up to 1000) and " +
  "`patch_lines` (up to 400) to read the whole change in one or two calls, and atlas_preview_get with up to 50 ids.";
