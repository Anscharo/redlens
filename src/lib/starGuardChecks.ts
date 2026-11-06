// A Prime's StarGuard as the daily Ethereum chain_state snapshot reads it: every
// chainlog StarGuard answers subProxy() and maxDelay(), so the one whose
// subProxy() is the instance's SubProxy Account is that Prime's. Its maxDelay
// checks the atlas's "StarGuard Max Delay", and its subProxy() confirms a
// SubProxy Account where none of the Prime's controller contracts is indexed.
import type { ChainValue } from "./chainstateTypes.ts";
import type { PlainCheck } from "./agentChecks.ts";
import { NOT_INDEXED } from "./pauAddressChecks.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";

type Values = Record<string, Record<string, ChainValue>>;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const UNIT_SECONDS: Record<string, number> = { second: 1, minute: 60, hour: 3_600, day: 86_400, week: 604_800 };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const notIndexed: PlainCheck = { status: "unsure", head: "Can't be checked", lines: [{ text: `${NOT_INDEXED[0].toUpperCase()}${NOT_INDEXED.slice(1)}.` }] };

/** The StarGuard whose subProxy() is `subProxy`, with its address. */
export function starGuardOf(values: Values, subProxy: string): { address: string; state: Record<string, ChainValue> } | null {
  for (const [address, state] of Object.entries(values)) {
    if (typeof state.subProxy === "string" && state.subProxy.toLowerCase() === subProxy && "maxDelay" in state) return { address, state };
  }
  return null;
}

/** "seven (7) days" or "48 hours" in seconds; null when no number and unit are found. */
function delaySeconds(text: string): number | null {
  const m = /\(?(\d+(?:\.\d+)?)\)?\s*(second|minute|hour|day|week)s?\b/i.exec(text);
  return m ? Number(m[1]) * UNIT_SECONDS[m[2].toLowerCase()] : null;
}

/** Seconds as the largest whole unit: 604800 → "7 days". */
function delayText(seconds: number): string {
  const [unit, size] = Object.entries(UNIT_SECONDS).filter(([u]) => u !== "week").reverse().find(([, n]) => seconds % n === 0) ?? ["second", 1];
  const n = seconds / size;
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** The instance's SubProxy Account, lowercased, if it lists one. */
const subProxyOf = (src: ValueSource) =>
  Object.entries(src.params).map(([name, [v]]) => (/subproxy/i.test(name) && ADDRESS_RE.test(v.trim()) ? v.trim().toLowerCase() : null)).find(Boolean) ?? null;

/** The "StarGuard Max Delay" row against the Prime's StarGuard's maxDelay(). */
export function maxDelayCheck(src: ValueSource, stated: string, values: Values): PlainCheck {
  const sub = subProxyOf(src);
  const guard = sub ? starGuardOf(values, sub) : null;
  const raw = guard ? Number(guard.state.maxDelay) : NaN;
  if (!guard || !Number.isFinite(raw)) return notIndexed;
  const lines = [{ label: "On-chain", value: delayText(raw) }, { label: "StarGuard", value: short(guard.address) }];
  const atlas = delaySeconds(stated);
  if (atlas === null) return { status: "unsure", head: "Can't be checked", lines: [{ text: "Atlas value not read." }, ...lines] };
  return atlas === raw ? { status: "match", head: "Matches the chain", lines } : { status: "mismatch", head: "Differs from the chain", lines: [...lines, { label: "Atlas", value: stated }] };
}

/** A SubProxy Account confirmed by the StarGuard that names it, where no controller contract is indexed; null when no StarGuard does. */
export function subProxyByStarGuard(address: string, values: Values | null): PlainCheck | null {
  const guard = values ? starGuardOf(values, address) : null;
  return guard ? { status: "match", head: "SubProxy on-chain", lines: [{ label: "SubProxy of", value: `StarGuard ${short(guard.address)}` }] } : null;
}
