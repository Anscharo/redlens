// How an ID or address row's check (src/lib/pauAddressChecks.ts) reads on an
// instance card: what the PAU holds for a stated RateLimitID, which rate limits
// and parameters use a listed address and the token it is, and what the chain
// records an instance's token wraps against the atlas's underlying asset.
import type { AddressCheck } from "@/lib/pauAddressChecks";
import type { LiveRateLimit } from "@/lib/pau";
import { shortAddress, sentence, type RowMark, type TipLine } from "./rowMark";
import { isOff } from "@/lib/pauLimitOrder";
import { limitSummary } from "./valueStatus";

const unique = (xs: string[]) => [...new Set(xs)];
const limitName = (r: LiveRateLimit) => r.derived?.constant ?? "Rate limit";

function idLines(c: AddressCheck): TipLine[] {
  if (c.status === "match") return c.limits.flatMap((r): TipLine[] => [{ label: limitName(r), value: limitSummary(r) }, { set: r.setAt, chain: c.chain!, readAt: null }]);
  if (c.status === "not-set") return [{ text: `A live read found this key never set on ${c.chain}.` }];
  return [{ text: `${sentence(c.reason ?? "")}.` }];
}

/** "USDS (0xdc03…384f)", or the address alone where no symbol was read. */
const named = (c: AddressCheck, a: string) => (c.symbols[a] ? `${c.symbols[a]} (${shortAddress(a)})` : shortAddress(a));

function addressLines(c: AddressCheck): TipLine[] {
  if (c.status !== "match") return [{ text: `${sentence(c.reason ?? "")}.` }];
  const symbol = c.symbols[c.subject];
  return [
    ...(symbol ? [{ label: "Token", value: symbol }] : []),
    ...(c.limits.length ? [{ label: "Rate limits", value: unique(c.limits.map(limitName)).join(", ") }] : []),
    ...(c.params.length ? [{ label: "Parameters", value: unique(c.params.map((p) => p.event)).join(", ") }] : []),
  ];
}

function underlyingLines(c: AddressCheck): TipLine[] {
  if (c.onchain.length === 0) return [{ text: `${sentence(c.reason ?? "")}.` }];
  return [{ label: "On-chain", value: c.onchain.map((a) => named(c, a)).join(", ") }];
}

/** An ID the atlas has not stated, for which the PAU holds keys derived from the instance's addresses: each key, one of which the atlas probably should state. */
function candidateLines(c: AddressCheck): TipLine[] {
  const seen = new Set<string>();
  const keys = c.limits.filter((r) => !isOff(r) && !seen.has(r.key.toLowerCase()) && seen.add(r.key.toLowerCase()));
  return [
    { text: "The PAU holds keys derived from this instance's addresses; the atlas probably should state one of them." },
    ...keys.map((r): TipLine => ({ label: limitName(r), value: `${r.key.slice(0, 10)}…${r.key.slice(-6)}` })),
  ];
}

const HEAD: Record<AddressCheck["kind"], Partial<Record<AddressCheck["status"], string>>> = {
  "rate-limit-id": { match: "Held on the PAU", "not-set": "Not set on the contract" },
  address: { match: "Used by the PAU" },
  underlying: { match: "Matches the chain", mismatch: "Differs from the chain" },
};

const LINES: Record<AddressCheck["kind"], (c: AddressCheck) => TipLine[]> = { "rate-limit-id": idLines, address: addressLines, underlying: underlyingLines };

/** An ID or address row's mark, opening the Onchain tab of the document that states it. */
export function addressRowMark(c: AddressCheck, docId: string | null): RowMark {
  if (c.status === "not-stated" && c.limits.some((r) => !isOff(r))) return { mark: "candidate", head: "The atlas states no ID, but the PAU holds a likely key", lines: candidateLines(c), docId };
  if (c.status === "not-stated") return { mark: "not-stated", head: "The atlas states no ID yet", lines: [{ text: "No key derived from this instance's addresses is switched on at the PAU either." }], docId };
  return { mark: c.status, head: HEAD[c.kind][c.status] ?? "Can't be checked", lines: LINES[c.kind](c), docId };
}
