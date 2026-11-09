// The accounts the atlas names to each vault's allocator and sentinel roles, by
// the vault its instance's Token Address names. A vault answers these roles
// only account by account (isAllocator, isSentinel), so the rebuild asks it
// about exactly these accounts (targets.ts). An instance naming no single vault
// claims nothing.
import fs from "node:fs";
import { roleAccounts, vaultOf, vaultRoleOf } from "../../lib/vaultRoles.ts";

export interface RoleClaim {
  allocators: string[];
  sentinels: string[];
}
export type RoleClaims = Map<string, RoleClaim>;

type Params = Record<string, [string, ...unknown[]]>;

/** One instance's claims on its vault, or null when it names no vault or no such role. */
function claimOf(params: Params): [string, RoleClaim] | null {
  const vault = vaultOf(params);
  if (!vault) return null;
  const claim: RoleClaim = { allocators: [], sentinels: [] };
  for (const [name, [value]] of Object.entries(params)) {
    const role = vaultRoleOf(name);
    if (role === "allocator" || role === "sentinel") claim[`${role}s`].push(...roleAccounts(String(value)));
  }
  return claim.allocators.length || claim.sentinels.length ? [vault, claim] : null;
}

/** Every vault's claimed allocators and sentinels across the atlas's instances. */
export function atlasRoleClaims(file = "public/graph.json"): RoleClaims {
  const out: RoleClaims = new Map();
  if (!fs.existsSync(file)) {
    console.warn(`pau: ${file} missing; no vault is asked about its allocators or sentinels`);
    return out;
  }
  const graph = JSON.parse(fs.readFileSync(file, "utf8")) as { entities?: { meta?: string | object | null }[] };
  for (const e of graph.entities ?? []) {
    const meta = (typeof e.meta === "string" ? JSON.parse(e.meta) : (e.meta ?? {})) as { params?: Params };
    const found = meta.params ? claimOf(meta.params) : null;
    if (!found) continue;
    const [vault, claim] = found;
    const prev = out.get(vault) ?? { allocators: [], sentinels: [] };
    out.set(vault, { allocators: [...new Set([...prev.allocators, ...claim.allocators])], sentinels: [...new Set([...prev.sentinels, ...claim.sentinels])] });
  }
  return out;
}
