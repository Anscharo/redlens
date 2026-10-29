// The order a deployment's rate-limit table shows its rows in once the reader
// sorts it by a column (the Radar PAUs page). Until then the rows keep
// orderedLimits' grouping (pauLimitOrder.ts); a sort is stable, so rows tied on
// the column keep that order. Amounts compare in whole tokens, each row at its
// own decimals, so a USDC limit and a USDS one compare by what they hold. Pure.
import type { AtlasVerdict } from "./pauAtlasMatch.ts";
import type { LiveRateLimit } from "./pau.ts";
import { isOff } from "./pauLimitOrder.ts";
import { limitDecimals } from "./pauView.ts";

export const LIMIT_COLUMNS = ["name", "maxAmount", "slope", "atlas", "updated"] as const;
export type LimitColumn = (typeof LIMIT_COLUMNS)[number];

export interface LimitSort {
  by: LimitColumn;
  desc: boolean;
}

/** A row as the sort reads it: the name it shows and its Atlas column's rank (`atlasRank`). */
export interface SortableLimit {
  r: LiveRateLimit;
  name: string;
  atlas: number;
}

/** Clicking a column sorts by it ascending; clicking it again flips the direction. */
export const nextSort = (cur: LimitSort | null, by: LimitColumn): LimitSort => ({ by, desc: cur?.by === by ? !cur.desc : false });

/** The Atlas column's rank, by what its cell shows (PauAtlasMark.tsx): ✗, then ⚑, then ?, then ✓, then blank. */
export function atlasRank(shown: AtlasVerdict | undefined, keyDocId: string | null | undefined, flagged: boolean): number {
  if (shown?.mark === "mismatch") return 0;
  if (!shown && !keyDocId) return flagged ? 1 : 4;
  return shown?.mark === "match" ? 3 : 2;
}

const whole = (raw: string, dec: number) => Number(raw) / 10 ** dec;

function value(s: SortableLimit, by: LimitColumn): number | string {
  const max = s.r.data?.maxAmount ?? s.r.configured.maxAmount;
  const dec = limitDecimals(s.r.unit, max);
  if (by === "name") return s.name.toLowerCase();
  if (by === "maxAmount") return isOff(s.r) ? 0 : whole(max, dec);
  if (by === "slope") return whole(s.r.data?.slope ?? s.r.configured.slope, dec);
  if (by === "atlas") return s.atlas;
  return s.r.setAt.time;
}

/** The rows in the order `sort` asks for; as given when there is no sort. */
export function sortLimits<T extends SortableLimit>(rows: T[], sort: LimitSort | null): T[] {
  if (!sort) return rows;
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const [x, y] = [value(a, sort.by), value(b, sort.by)];
    return dir * (typeof x === "string" ? x.localeCompare(String(y), "en", { numeric: true }) : x - (y as number));
  });
}
