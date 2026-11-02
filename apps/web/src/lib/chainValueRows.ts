// The Onchain panel's "view functions" rows (AddressCard): the chain-state
// values worth showing, each formatted for display and flagged when it is an
// address the card renders as an explorer link.
import type { ChainValue } from "./chainstate";
import { EVM_ADDRESS_EXACT_RE } from "@/lib/patterns";

export interface ChainValueRow {
  key: string;
  display: string;
  isAddress: boolean;
}

function formatValue(val: ChainValue): string {
  if (val === null) return "—";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.map(formatValue).join(", ");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

// Unset values and the EIP-712 constants every token exposes say nothing about this contract.
function isSkippable(key: string, val: ChainValue): boolean {
  if (val === null || val === "" || val === "0x0000000000000000000000000000000000000000") return true;
  return key === "DOMAIN_SEPARATOR" || key === "PERMIT_TYPEHASH";
}

export function chainValueRows(chainValues: Record<string, ChainValue>): ChainValueRow[] {
  return Object.entries(chainValues)
    .filter(([k, v]) => !isSkippable(k, v))
    .map(([key, val]) => ({ key, display: formatValue(val), isAddress: typeof val === "string" && EVM_ADDRESS_EXACT_RE.test(val) }));
}
