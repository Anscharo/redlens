// Whether a contract's rate limit is what the atlas states, said only as far as
// it is certain. Zero and unlimited need no units. Otherwise the amount compares
// in the key's token units; where those are unknown (no rule names the token),
// a mismatch is claimed only when the value is wrong at every scale from 0 to 18
// decimals, and a match only when the one scale that fits is the inferred one
// and agrees with the token the atlas names. Anything else is "units-unknown".
import type { LiveRateLimit } from "./pau.ts";
import { shiftDecimal, type StatedValue } from "./pauParams.ts";
import { inferDecimals } from "./pauView.ts";

export type Verdict = "match" | "mismatch" | "units-unknown";
type Stated = Extract<StatedValue, { kind: "amount" | "unlimited" }>;

const UNLIMITED = (1n << 256n) - 1n;
const DAY = 86_400n;
const SCALES = Array.from({ length: 19 }, (_, i) => i);
const SYMBOL_DECIMALS: Record<string, number> = { usdc: 6, usdt: 6, usdt0: 6, pyusd: 6, ausd: 6, usdg: 6, usds: 18, dai: 18, usde: 18, susds: 18, fsusds: 18, rlusd: 18 };

/** The decimals of every token the atlas names ("USDC/AUSD", "RLUSD or USDC"), or null when one is not known. */
function namedDecimals(symbol: string | null): number[] | null {
  if (!symbol) return null;
  const parts = symbol.toLowerCase().split(/\s*(?:\/|\bor\b)\s*/).filter(Boolean);
  const decimals = parts.map((p) => SYMBOL_DECIMALS[p]);
  return decimals.every((d) => d !== undefined) ? decimals : null;
}

function agreesAt(units: string, field: "maxAmount" | "slope", max: bigint, slope: bigint, decimals: number): boolean {
  const raw = BigInt(shiftDecimal(units, decimals).split(".")[0]);
  if (field === "maxAmount") return max === raw;
  return slope === raw / DAY || slope === (raw + DAY - 1n) / DAY;
}

/**
 * The verdict on a live limit (`r.data` read). A limit switched off on the
 * chain agrees with any slope when the atlas switches it off too (`statedOff`):
 * neither lets anything through.
 */
export function verdict(stated: Stated, field: "maxAmount" | "slope", r: LiveRateLimit & { data: NonNullable<LiveRateLimit["data"]> }, statedOff = false): Verdict {
  const max = BigInt(r.data.maxAmount);
  const slope = BigInt(r.data.slope);
  if (field === "slope" && max === 0n && statedOff) return "match";
  if (stated.kind === "unlimited") return max === UNLIMITED ? "match" : "mismatch";
  if (max === UNLIMITED) return "mismatch";
  const at = (d: number) => agreesAt(stated.units, field, max, slope, d);
  if (/^0(\.0*)?$/.test(stated.units) || r.unit) return at(r.unit?.decimals ?? 0) ? "match" : "mismatch";
  const fits = SCALES.filter(at);
  if (fits.length === 0) return "mismatch";
  const guess = inferDecimals(max.toString());
  const named = namedDecimals(stated.symbol);
  return fits.length === 1 && fits[0] === guess && (!named || named.includes(guess)) ? "match" : "units-unknown";
}
