import { Address } from "../Address";
import { holderRows, type HolderStatus, type PauSnapshot } from "../../lib/pau";

const STATUS: Record<HolderStatus, { mark: string; text: string; color: string }> = {
  holds: { mark: "✓", text: "holds the role", color: "var(--tan-2)" },
  member: { mark: "✓", text: "listed by the AdministeredAgent", color: "var(--tan-2)" },
  denied: { mark: "✗", text: "granted in the history but the chain says it does not hold the role", color: "var(--accent)" },
  unread: { mark: "?", text: "hasRole could not be read", color: "var(--tan-3)" },
};

const ON_LABEL: Record<string, string> = {
  controller: "controller",
  almProxy: "proxy",
  rateLimits: "rate limits",
  accessControls: "access controls",
  administeredAgent: "agent",
};

/** Who holds which role on which PAU contract, each marked as the chain confirms it. */
export function PauHolders({ snap }: { snap: PauSnapshot }) {
  const rows = holderRows(snap);
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--tan-3)" }}>Roles</h4>
      <ul className="space-y-0.5">
        {rows.map((r) => {
          const s = STATUS[r.status];
          return (
            <li key={`${r.on}:${r.name}:${r.account}`} className="mono text-[10px] flex flex-wrap items-baseline gap-x-2" data-status={r.status}>
              <span style={{ color: s.color }} title={s.text} aria-label={s.text}>{s.mark}</span>
              <span style={{ color: "var(--tan-2)" }}>{r.name}</span>
              <span style={{ color: "var(--tan-3)" }}>on {ON_LABEL[r.on] ?? r.on}</span>
              <Address address={r.account} chain={snap.chain} />
              <span style={{ color: "var(--tan-3)" }}>since {r.since.time.slice(0, 10)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
