import { Address } from "../Address";
import type { AtlasKeyRef, PauParam, StoredPauSnapshot } from "../../lib/pau";
import { PauHolders } from "./ActorPauHolders";
import { PauRateLimits } from "./ActorPauRateLimits";

const ROLE_LABEL: Record<string, string> = {
  controller: "Controller",
  almProxy: "ALM proxy",
  rateLimits: "Rate limits",
  accessControls: "AccessControls",
  administeredAgent: "AdministeredAgent",
};

const chainLabel = (chain: string) => chain.charAt(0).toUpperCase() + chain.slice(1);
const dim = { color: "var(--tan-3)" };

/** One deployment: a collapsible card with its contracts, holders, rate limits and parameters. */
export function PauDeployment({ snap, keyIndex, defaultOpen }: { snap: StoredPauSnapshot; keyIndex: Map<string, AtlasKeyRef[]>; defaultOpen: boolean }) {
  const limits = snap.contracts.flatMap((c) => c.rateLimits ?? []);
  const params = snap.contracts.flatMap((c) => (c.params ?? []).map((p) => ({ ...p, contract: c.address })));
  const loading = snap.contracts.some((c) => !c.historyComplete);
  return (
    <details open={defaultOpen} className="pau-deployment mb-3 border-t border-[var(--border)] pt-2" data-deployment={snap.deployment} data-kind={snap.kind}>
      <summary className="cursor-pointer mono text-[11px] flex flex-wrap items-baseline gap-2" style={{ color: "var(--tan)" }}>
        <span>{chainLabel(snap.chain)}</span>
        <span className="text-[10px] px-1.5 rounded" style={{ border: "1px solid var(--border)", color: "var(--tan-2)" }}>{snap.kind}</span>
        <span className="text-[10px]" style={dim}>{limits.length} rate limits</span>
        {loading && <span className="text-[10px]" style={{ color: "var(--accent)" }}>history still being read</span>}
      </summary>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {snap.contracts.map((c) => (
          <li key={c.address} className="mono text-[10px]" style={dim}>
            {ROLE_LABEL[c.role] ?? c.role} <Address address={c.address} chain={snap.chain} />
          </li>
        ))}
      </ul>
      <PauHolders snap={snap} />
      <PauRateLimits chain={snap.chain} limits={limits} keyIndex={keyIndex} />
      <PauParams params={params} />
      <p className="mono text-[10px] mt-2" style={dim}>read {snap.fetchedAt.slice(0, 16).replace("T", " ")} UTC</p>
    </details>
  );
}

const paramValue = (p: PauParam) =>
  Object.entries(p.args)
    .filter(([, v]) => String(v) !== p.subject)
    .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");

/** The latest value of each per-pool or per-domain parameter (max slippage, recipients, tick bounds). */
function PauParams({ params }: { params: (PauParam & { contract: string })[] }) {
  if (params.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="mono text-[10px] uppercase tracking-wider mb-1" style={dim}>Parameters</h4>
      <ul className="space-y-0.5">
        {params.map((p) => (
          <li key={`${p.contract}:${p.event}:${p.subject}`} className="mono text-[10px] break-words" style={{ color: "var(--tan-2)" }}>
            {p.event} <span title={p.subject}>{p.subject.length > 20 ? `${p.subject.slice(0, 10)}…` : p.subject}</span>{" "}
            <span style={dim}>{paramValue(p)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
