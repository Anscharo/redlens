// How an ID or address row's check (src/lib/pauAddressChecks.ts) reads on an
// instance card: what the PAU holds for a stated RateLimitID, which rate limits
// and parameters use a listed address and the token it is, and what the chain
// records an instance's token wraps against the atlas's underlying asset.
import type { AddressCheck } from "@/lib/pauAddressChecks";
import type { LiveRateLimit } from "@/lib/pau";
import { shortAddress, sentence, type RowMark, type TipLine } from "./rowMark";
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

/** An ID the atlas has not stated: nothing to compare, but the keys the PAU derives from the instance's addresses. */
function unstatedLines(c: AddressCheck): TipLine[] {
  const derived: TipLine[] = c.limits.length ? [{ label: "Derived keys", value: unique(c.limits.map(limitName)).join(", ") }] : [];
  return [{ text: "Nothing to compare until the atlas states one." }, ...derived];
}

const HEAD: Record<AddressCheck["kind"], Partial<Record<AddressCheck["status"], string>>> = {
  "rate-limit-id": { match: "Held on the PAU", "not-set": "Not set on the contract", "not-stated": "The atlas states no ID yet" },
  address: { match: "Used by the PAU" },
  underlying: { match: "Matches the chain", mismatch: "Differs from the chain" },
};

const LINES: Record<AddressCheck["kind"], (c: AddressCheck) => TipLine[]> = { "rate-limit-id": idLines, address: addressLines, underlying: underlyingLines };

/** An ID or address row's mark, opening the Onchain tab of the document that states it. */
export function addressRowMark(c: AddressCheck, docId: string | null): RowMark {
  const head = HEAD[c.kind][c.status] ?? "Can't be checked";
  const lines = c.status === "not-stated" ? unstatedLines(c) : LINES[c.kind](c);
  return { mark: c.status, head, lines, docId };
}
