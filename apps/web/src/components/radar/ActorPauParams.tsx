import { Address } from "../Address";
import { Callout } from "../Callout";
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

const rowName = (p: PauParam) => `${paramTitle(p.event)} ${paramTarget(p.event, p.subject) ?? p.subject}`;

/** A contract's settings by what they are called and what they are for. */
const paramsByName = (params: PauParam[]) => [...params].sort((a, b) => rowName(a).localeCompare(rowName(b), "en", { numeric: true }) || a.subject.localeCompare(b.subject));

/**
 * The latest value of each per-pool, per-token or per-destination setting a PAU
 * contract holds (max slippage, recipients, tick bounds), grouped by the contract
 * holding it. Each row is the last admin event that set it: the setting and what
 * it is for, its value, and when and from where it was set.
 */
export function PauParams({ snap, anchor }: { snap: StoredPauSnapshot; anchor: Anchor }) {
  const held = snap.contracts.filter((c) => (c.params ?? []).length > 0).sort((a, b) => contractLabel(a).localeCompare(contractLabel(b)) || a.address.localeCompare(b.address));
  if (held.length === 0) return null;
  return (
    <div className="mt-3">
      <PauSectionHeading deployment={anchor} section="parameters">Parameters</PauSectionHeading>
      <Callout className="mb-2">Settings each contract holds for a pool, token or destination, as the last admin event that set each one says.</Callout>
      {held.map((c) => (
        <section key={c.address} className="mb-2" data-contract={c.address}>
          <h5 className="mono text-[11px] flex items-baseline gap-2" style={{ color: "var(--tan)" }}>
            {contractLabel(c)} <Address address={c.address} chain={snap.chain} noBalance />
          </h5>
          <ul className="space-y-0.5 pl-3">
            {paramsByName(c.params ?? []).map((p) => (
              <li key={`${p.event}:${p.subject}`} className="mono text-[11px] break-words" style={{ color: "var(--tan-2)" }} title={p.event}>
                {paramTitle(p.event)} <span title={p.subject}>{paramTarget(p.event, p.subject) ?? clip(p.subject)}</span>
                {" → "}
                <Values p={p} />{" "}
                <span style={dim}>set {p.setAt.time.slice(0, 10)}</span> <PauOriginChip chain={snap.chain} tx={p.setAt.tx} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
