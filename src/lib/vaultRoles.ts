// How the atlas names a vault's roles: an instance param "Owner Role Address",
// "Curator Role Address", "Sentinel Role Address" or "Allocator Role
// Address(es)", whose value is a bare address, a sentence naming one, or a
// table of several. Shared by the worker, which asks the vault about each named
// allocator and sentinel (src/server/pau/role-claims.ts), and the card checks
// (vaultRoleChecks.ts).
import { EVM_ADDRESS_SRC } from "./patterns.ts";

export type VaultRole = "owner" | "curator" | "allocator" | "sentinel";

const ROLE_PARAM_RE = /\b(owner|curator|allocator|sentinel)\s+role\s+address/i;

/** The role a param names, or null for any other param. */
export function vaultRoleOf(name: string): VaultRole | null {
  const m = ROLE_PARAM_RE.exec(name);
  return m ? (m[1].toLowerCase() as VaultRole) : null;
}

/** Every address the value states, lowercased, in order. */
export const roleAccounts = (text: string): string[] => [...new Set((text.match(new RegExp(EVM_ADDRESS_SRC, "g")) ?? []).map((a) => a.toLowerCase()))];

/** The vault an instance names in its "Token Address" param, lowercased, if it is one address. */
export function vaultOf(params: Record<string, [string, ...unknown[]]>): string | null {
  const v = Object.entries(params).find(([name]) => /^token address$/i.test(name.trim()))?.[1][0].trim() ?? "";
  const accounts = roleAccounts(v);
  return accounts.length === 1 && accounts[0] === v.toLowerCase() ? accounts[0] : null;
}
