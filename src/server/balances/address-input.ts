// One atlas_addresses row → the balance fetcher's input, shared by the
// /api/balances POST and the worker's rolling refresh so the two select and
// read the same columns.
import type { AddressInput } from "./fetch-balances.ts";

export interface AddressRow {
  address: string;
  chain: string;
  expected_tokens: string[] | null;
  is_contract: boolean | null;
  roles: unknown;
  etherscan_name: string | null;
}

// jsonb arrives decoded, but a row written as a JSON string scalar still reads
// as text; accept both rather than miss a label.
function rolesOf(raw: unknown): string[] {
  const v = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
  return Array.isArray(v) ? v.filter((r): r is string => typeof r === "string") : [];
}

// Etherscan verifies Safe 1.3+ proxies as SafeProxy and earlier ones as
// GnosisSafeProxy; both answer getThreshold/getOwners.
const SAFE_PROXY_NAMES = new Set(["SafeProxy", "GnosisSafeProxy"]);

/** Worth a Safe read: a multisig role or a verified Safe proxy (either generation). */
export function isLabelledMultisig(roles: unknown, etherscanName: string | null): boolean {
  return rolesOf(roles).includes("multisig") || (etherscanName != null && SAFE_PROXY_NAMES.has(etherscanName));
}

export function toAddressInput(r: AddressRow): AddressInput {
  return {
    address: r.address,
    chain: r.chain,
    expectedTokens: Array.isArray(r.expected_tokens) ? r.expected_tokens : [],
    isContract: r.is_contract ?? false,
    multisig: isLabelledMultisig(r.roles, r.etherscan_name),
  };
}
