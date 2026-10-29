import { Address } from "../Address";
import { holderRows, type HolderStatus, type PauSnapshot } from "../../lib/pau";
import type { Anchor } from "@/lib/pauAnchors";
import { holderNames, isFreezable } from "@/lib/pauHolderNames";
import { PauOriginChip } from "./PauOriginChip";
import { PauSectionHeading } from "./PauSectionHeading";
import { MARK_TIP_MS } from "./PauAtlasMark";
import { Tooltip } from "../Tooltip";

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

const VERB = { role: { denied: "was granted", else: "holds" }, member: { denied: "was added as", else: "is" } };

/** Who holds which role on which PAU contract, each marked as the chain confirms it. */
export function PauHolders({ snap, anchor }: { snap: PauSnapshot; anchor: Anchor }) {
  const rows = holderRows(snap);
  if (rows.length === 0) return null;
  const names = holderNames(snap);
  const freezable = new Set(snap.contracts.filter(isFreezable).map((c) => c.address.toLowerCase()));
  const onLabel = (on: string, contract: string) => (freezable.has(contract.toLowerCase()) ? "freezable proxy" : ON_LABEL[on] ?? on);
  return (
    <div className="mt-3">
      <PauSectionHeading deployment={anchor} section="roles">Roles</PauSectionHeading>
      <ul className="space-y-0.5">
        {rows.map((r) => {
          const s = STATUS[r.status];
          const text = s[r.check];
          return (
            <li key={`${r.contract}:${r.name}:${r.account}`} className="mono text-[11px] flex flex-wrap items-baseline gap-x-2" data-status={r.status}>
              <Tooltip content={text} delay={MARK_TIP_MS}>
                <span role="img" style={{ color: s.color }} aria-label={text}>{s.mark}</span>
              </Tooltip>
              {names.get(r.account.toLowerCase()) && <span style={{ color: "var(--tan-2)" }}>{names.get(r.account.toLowerCase())}</span>}
              <Address address={r.account} chain={snap.chain} />
              <span style={{ color: "var(--tan-3)" }}>{VERB[r.check][r.status === "denied" ? "denied" : "else"]}</span>
              <span style={{ color: "var(--tan-2)" }}>{r.name}</span>
              <span style={{ color: "var(--tan-3)" }}>on {onLabel(r.on, r.contract)}</span>
              <span style={{ color: "var(--tan-3)" }}>{r.since ? `since ${r.since.time.slice(0, 10)}` : "not in the stored history"}</span>
              {r.since && <PauOriginChip chain={snap.chain} tx={r.since.tx} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
