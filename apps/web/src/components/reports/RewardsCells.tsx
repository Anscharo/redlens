import { Link } from "../Link";
import { actorHref } from "@/lib/routes";
import { shortAddr } from "../../lib/format";
import { Address } from "../Address";
import { resolveAddressName, resolveOwner, hasResolvedName } from "../../lib/addressName";
import type { AddressInfo } from "@/types";
import type { EntityRef } from "@/lib/rewardsIndex";

export function EntityChip({ e }: { e: EntityRef }) {
  return (
    <Link
      to={actorHref(e.slug)}
      className="text-[11px] text-accent hover:underline mono"
    >
      {e.name}
    </Link>
  );
}

// InProgress is an Invocation status (not an Instance status) per atlas
// A.2.2.1.4. Its pill is intentionally rendered as an outline (transparent
// fill + dashed border) so it doesn't read as a peer of Active/Suspended/
// Completed — those are operational, InProgress is pre-operational.
const STATUS_STYLE: Record<string, string> = {
  Active: "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-tan",
  Completed: "bg-[var(--hover)] text-tan-3",
  Suspended: "bg-[color-mix(in_srgb,var(--red)_18%,transparent)] text-tan-2",
  InProgress: "bg-transparent text-accent border border-dashed border-[var(--accent)]",
  Inactive: "bg-transparent text-tan-3 opacity-60 border border-[var(--border)]",
};

export function StatusPill({ s }: { s: string }) {
  return (
    <span className={`mono text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[s] ?? ""}`}>{s}</span>
  );
}

export function AddressLink({
  addr,
  chain,
  addrMap,
}: {
  addr: string;
  chain?: string;
  addrMap: Record<string, AddressInfo>;
}) {
  const short = shortAddr(addr);
  const info = addrMap[addr.toLowerCase()] ?? addrMap[addr];
  const name = resolveAddressName(addr, info);
  const owner = resolveOwner(info);
  return (
    <Address
      address={addr}
      chain={chain}
      addrMap={addrMap}
      className="text-[11px]"
      title={owner ? `${owner} — ${addr}` : addr}
    >
      {hasResolvedName(info) ? `${name} · ${short}` : short}
    </Address>
  );
}
