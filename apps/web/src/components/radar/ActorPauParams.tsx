import type { PauParam, StoredPauSnapshot } from "../../lib/pau";
import type { Anchor } from "@/lib/pauAnchors";
import { contractLabel } from "@/lib/pauHolderNames";
import { paramTarget, paramTitle } from "@/lib/pauParamText";
import { PauOriginChip } from "./PauOriginChip";
import { PauSectionHeading } from "./PauSectionHeading";

const dim = { color: "var(--tan-3)" };
const clip = (v: string) => (v.length > 20 ? `${v.slice(0, 10)}…${v.slice(-6)}` : v);

/** The event's other arguments: a lone value alone ("0x3387…0e6b40"), several as "name value". */
function Values({ p }: { p: PauParam }) {
  const rest = Object.entries(p.args).filter(([, v]) => String(v) !== p.subject);
  const text = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <>
      {rest.map(([k, v], i) => (
        <span key={k} title={`${k} ${text(v)}`}>
          {i > 0 && " · "}
          {rest.length > 1 && `${k} `}
          {clip(text(v))}
        </span>
      ))}
    </>
  );
}

/**
 * The latest value of each per-pool, per-token or per-destination setting a PAU
 * contract holds (max slippage, recipients, tick bounds). Each row is the last
 * admin event that set it on that contract: what it is, what it is for, which
 * contract holds it, and when and from where it was set.
 */
export function PauParams({ snap, anchor }: { snap: StoredPauSnapshot; anchor: Anchor }) {
  const params = snap.contracts.flatMap((c) => (c.params ?? []).map((p) => ({ ...p, contract: c })));
  if (params.length === 0) return null;
  return (
    <div className="mt-3">
      <PauSectionHeading deployment={anchor} section="parameters">Parameters</PauSectionHeading>
      <p className="text-[12px] mb-1" style={{ color: "var(--tan-2)" }}>
        Settings the contracts above hold for each pool, token or destination, as the last admin event that set each one says.
      </p>
      <ul className="space-y-0.5">
        {params.map((p) => (
          <li key={`${p.contract.address}:${p.event}:${p.subject}`} className="mono text-[11px] break-words" style={{ color: "var(--tan-2)" }} title={`${p.event} on ${p.contract.address}`}>
            {paramTitle(p.event)}{" "}
            <span title={p.subject}>{paramTarget(p.event, p.subject) ?? clip(p.subject)}</span>{" "}
            <span style={dim}><Values p={p} /> · on {contractLabel(p.contract)} · set {p.setAt.time.slice(0, 10)}</span>{" "}
            <PauOriginChip chain={snap.chain} tx={p.setAt.tx} />
          </li>
        ))}
      </ul>
    </div>
  );
}
