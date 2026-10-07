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

/** Charges a returned large result against the turn's total. */
export function chargeLargeRead(largeResult: boolean | undefined, read: LargeRead | null | undefined, chars: number): void {
  if (largeResult && read) read.left = Math.max(0, read.left - chars);
}

/** The system-prompt line that tells the model it may ask for large pages. */
export const LARGE_READ_PROMPT =
  "This turn can read large PR previews. To review a PR, call atlas_preview_diff with a high `limit` (up to 1000) and " +
  "`patch_lines` (up to 400) to read the whole change in one or two calls, and atlas_preview_get with up to 50 ids.";
