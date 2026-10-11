import { Address } from "../Address";
import { holderRows, type HolderStatus, type PauSnapshot } from "../../lib/pau";
import type { Anchor } from "@/lib/pauAnchors";
import { PauOriginChip } from "./PauOriginChip";
import { PauSectionHeading } from "./PauSectionHeading";

const STATUS: Record<HolderStatus, { mark: string; color: string; role: string; member: string }> = {
  holds: { mark: "✓", color: "var(--tan-2)", role: "holds the role", member: "the AdministeredAgent lists it" },
  denied: { mark: "✗", color: "var(--accent)", role: "granted in the history but the chain says it does not hold the role", member: "added in the history but the AdministeredAgent no longer lists it" },
  unread: { mark: "?", color: "var(--tan-3)", role: "hasRole could not be read", member: "membership could not be read" },
};

const ON_LABEL: Record<string, string> = {
  controller: "controller",
  almProxy: "proxy",
  rateLimits: "rate limits",
  accessControls: "access controls",
  administeredAgent: "agent",
};

/** Who holds which role on which PAU contract, each marked as the chain confirms it. */
export function PauHolders({ snap, anchor }: { snap: PauSnapshot; anchor: Anchor }) {
  const rows = holderRows(snap);
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <PauSectionHeading deployment={anchor} section="roles">Roles</PauSectionHeading>
      <ul className="space-y-0.5">
        {rows.map((r) => {
          const s = STATUS[r.status];
          const text = s[r.check];
          return (
            <li key={`${r.contract}:${r.name}:${r.account}`} className="mono text-[11px] flex flex-wrap items-baseline gap-x-2" data-status={r.status}>
              <span style={{ color: s.color }} title={text} aria-label={text}>{s.mark}</span>
              <span style={{ color: "var(--tan-2)" }}>{r.name}</span>
              <span style={{ color: "var(--tan-3)" }}>on {ON_LABEL[r.on] ?? r.on}</span>
              <Address address={r.account} chain={snap.chain} />
              <span style={{ color: "var(--tan-3)" }}>{r.since ? `since ${r.since.time.slice(0, 10)}` : "not in the stored history"}</span>
              {r.since && <PauOriginChip chain={snap.chain} tx={r.since.tx} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
