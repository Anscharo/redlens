import type { KeyHolder } from "@/lib/pauKeyHolders";
import { isOff } from "@/lib/pauLimitOrder";
import { formatAmount, formatPerDay, limitDecimals, PAU_KIND_LABEL, unitNote, type LiveRateLimit } from "../lib/pau";
import { shortAddr } from "../lib/format";
import { chainLabel, readAt } from "../lib/pauPlaces";

const dim = { color: "var(--tan-3)" };

/** A limit's maxAmount as it reads: "off" when switched off, "unlimited" at the uint256 sentinel, else compact with its symbol. */
function maxText(r: LiveRateLimit, dec: number, symbol: string): string {
  if (isOff(r)) return "0 (off)";
  const amount = formatAmount((r.data ?? r.configured).maxAmount, dec);
  return amount === "unlimited" ? amount : `${amount}${symbol}`;
}

/**
 * Where a holder is, told apart from the card's other holders: the controller
 * kind when the prime has two deployments on the chain, and the RateLimits
 * contract when one deployment has two holding the key.
 */
function heading(h: KeyHolder, all: KeyHolder[]): string {
  const sameChain = all.filter((x) => x.snap.prime === h.snap.prime && x.snap.chain === h.snap.chain);
  const kind = sameChain.some((x) => x.snap.deployment !== h.snap.deployment) ? ` · ${PAU_KIND_LABEL[h.snap.kind]}` : "";
  const contract = sameChain.filter((x) => x.snap.deployment === h.snap.deployment).length > 1 ? ` · ${shortAddr(h.contract)}` : "";
  return `${h.snap.primeName} · ${chainLabel(h.snap.chain)}${kind}${contract}`;
}

/** One contract's limit for the key: maxAmount and refill per day, in the key's unit when the worker read one. */
function HolderLimit({ h, where }: { h: KeyHolder; where: string }) {
  const r = h.limit;
  const v = r.data ?? r.configured;
  const dec = limitDecimals(r.unit, v.maxAmount);
  const symbol = r.unit?.symbol ? ` ${r.unit.symbol}` : "";
  return (
    <div className="mt-1.5 first:mt-0" data-chain={h.snap.chain}>
      <div className="text-tan-2 break-words">{where}</div>
      <div className="mono text-[10px] text-tan-2">
        <div className="flex justify-between gap-3"><span style={dim}>maxAmount</span><span>{maxText(r, dec, symbol)}</span></div>
        <div className="flex justify-between gap-3"><span style={dim}>slope</span><span>{formatPerDay(v.slope, dec)}{symbol} per day</span></div>
        {!r.unit && <div style={dim}>{unitNote(r.unit, v.maxAmount)}</div>}
        {!r.data && <div style={dim}>live read failed; the last value its history set</div>}
      </div>
    </div>
  );
}

/** The hover card on a RateLimitID: what each PAU contract holding the key has it set to on chain. */
export function RateLimitKeyCard({ holders }: { holders: KeyHolder[] }) {
  const name = holders.map((h) => h.limit.derived?.constant).find(Boolean);
  const read = readAt(holders);
  return (
    <div className="min-w-[10rem] max-w-[18rem]">
      <div className="font-medium text-tan">On-chain rate limit</div>
      {name && <div className="mono text-[10px] truncate" style={dim}>{name}</div>}
      <div className="mt-1">
        {holders.map((h) => <HolderLimit key={`${h.snap.deployment}:${h.contract}`} h={h} where={heading(h, holders)} />)}
      </div>
      {read && <div className="mono text-[10px] mt-1.5" style={dim}>read {read} UTC</div>}
    </div>
  );
}
