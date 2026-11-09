// A vault's roles as an instance states them, against what the vault itself
// answers in the stored snapshots (src/server/pau/targets.ts): its owner() and
// curator() must be among the addresses the atlas states for the role, and
// every account the atlas names an allocator or sentinel must be one by
// isAllocator / isSentinel. A vault answers those two only for an account it is
// asked about, so they are checked only for the accounts the atlas names, and an
// atlas that names none has nothing to check.
import type { StoredPauSnapshot, TargetState } from "./pau.ts";
import { addressCheckId } from "./pauAddressChecks.ts";
import { chainSnaps } from "./pauInstanceChain.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";
import { isUnstated, notIndexed, shortAddress as short, unsure, type PlainCheck, type PlainLine } from "./plainCheck.ts";
import { roleAccounts, vaultOf, vaultRoleOf, type VaultRole } from "./vaultRoles.ts";

const ZERO = `0x${"0".repeat(40)}`;
const notRead: PlainLine = { text: "Atlas value not read." };

/** The owner or curator against the addresses the atlas states for it. */
function accountCheck(stated: string, onchain: string | undefined, vaultLine: PlainLine): PlainCheck {
  if (!onchain) return notIndexed;
  const lines = [{ label: "On-chain", value: onchain === ZERO ? "none set" : short(onchain) }, vaultLine];
  if (isUnstated(stated)) {
    return onchain === ZERO ? { status: "not-stated", head: "The atlas states no value yet", lines } : { status: "candidate", head: "The atlas states no value, but the chain holds one", lines };
  }
  const claimed = roleAccounts(stated);
  if (claimed.length === 0) return { status: "unsure", head: "Can't be checked", lines: [notRead, ...lines] };
  if (claimed.includes(onchain)) return { status: "match", head: "Matches the chain", lines };
  return { status: "mismatch", head: "Differs from the chain", lines: [...lines, { label: "Atlas", value: claimed.map(short).join(", ") }] };
}

/** Whether each account the atlas names to the role holds it on the vault. */
function holderCheck(role: "allocator" | "sentinel", stated: string, held: Record<string, boolean> | undefined, vaultLine: PlainLine): PlainCheck {
  if (isUnstated(stated)) return { status: "not-stated", head: "The atlas states no value yet", lines: [{ text: `The vault is asked only about accounts the atlas names as ${role}s.` }] };
  const claimed = roleAccounts(stated);
  if (claimed.length === 0) return { status: "unsure", head: "Can't be checked", lines: [notRead, vaultLine] };
  if (claimed.some((a) => held?.[a] === undefined)) return notIndexed;
  const article = role === "allocator" ? "an" : "a";
  const lines = claimed.map((a) => ({ label: short(a), value: held![a] ? `${role[0].toUpperCase()}${role.slice(1)}` : `Not ${article} ${role}` }));
  const every = claimed.every((a) => held![a]);
  return every ? { status: "match", head: "Matches the chain", lines: [...lines, vaultLine] } : { status: "mismatch", head: "Differs from the chain", lines: [...lines, vaultLine] };
}

function roleCheck(role: VaultRole, stated: string, target: TargetState, vault: string): PlainCheck {
  const vaultLine = { label: "Vault", value: short(vault) };
  if (role === "owner" || role === "curator") return accountCheck(stated, target[role], vaultLine);
  return holderCheck(role, stated, target[`${role}s`], vaultLine);
}

/** What the snapshots on the instance's chain read from its vault; null when none read it. */
function targetOf(src: ValueSource, vault: string, snaps: StoredPauSnapshot[]): TargetState | null {
  return chainSnaps(snaps, src).map((s) => s.targets?.[vault]).find((t) => t !== undefined) ?? null;
}

/** Every instance's vault role params, checked against the vault, keyed like the address checks. */
export function checkVaultRoles(sources: ValueSource[], snaps: StoredPauSnapshot[]): Map<string, PlainCheck> {
  const out = new Map<string, PlainCheck>();
  for (const src of sources) {
    const roles = Object.entries(src.params).flatMap(([name, [value]]) => {
      const role = vaultRoleOf(name);
      return role ? [{ name, role, value }] : [];
    });
    if (!src.docId || src.constant || roles.length === 0) continue;
    const vault = vaultOf(src.params);
    const target = vault ? targetOf(src, vault, snaps) : null;
    for (const { name, role, value } of roles) {
      const check = !vault ? unsure("this instance lists no single vault address") : target ? roleCheck(role, value, target, vault) : notIndexed;
      out.set(addressCheckId(src.docId, name), check);
    }
  }
  return out;
}
