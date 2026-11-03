import { Address } from "../Address";
import { Callout } from "../Callout";
import type { ContractState, PauParam, StoredPauSnapshot } from "../../lib/pau";
import type { Anchor } from "@/lib/pauAnchors";
import { contractLabel } from "@/lib/pauHolderNames";
import { paramTarget, paramTitle } from "@/lib/pauParamText";
import { isGuardParam, paramUse, type ParamUse } from "@/lib/pauParamUse";
import { PauParamRow } from "./ActorPauParamRow";
import { PauSectionHeading } from "./PauSectionHeading";

type Row = { p: PauParam; use: ParamUse | null };

const rowName = ({ p, use }: Row) => `${paramTitle(p.event)} ${use?.kind ?? ""} ${paramTarget(p.event, p.subject) ?? p.subjectToken?.symbol ?? p.subject}`;

/** A contract's settings that act, by what they are called, what they are set on and its name. A guard no rate limit lets act is left out (pauParamUse.ts). */
function rowsOf(snap: StoredPauSnapshot, params: PauParam[]): Row[] {
  const rows = params.map((p) => ({ p, use: isGuardParam(p.event) ? paramUse(snap, p) : null })).filter((r) => !r.use || r.use.state === "on");
  return rows.sort((a, b) => rowName(a).localeCompare(rowName(b), "en", { numeric: true }) || a.p.subject.localeCompare(b.p.subject));
}

/** One contract's settings that act. */
function ContractParams({ c, rows, chain }: { c: ContractState; rows: Row[]; chain: string }) {
  return (
    <section className="mb-2" data-contract={c.address}>
      <h5 className="mono text-[11px] flex items-baseline gap-2" style={{ color: "var(--tan)" }}>
        {contractLabel(c)} <Address address={c.address} chain={chain} noBalance />
      </h5>
      <ul className="space-y-0.5 pl-3">
        {rows.map((r) => <PauParamRow key={`${r.p.event}:${r.p.subject}`} p={r.p} chain={chain} use={r.use} />)}
      </ul>
    </section>
  );
}

/**
 * The latest value of each per-pool, per-token or per-destination setting a PAU
 * contract holds (max slippage, recipients, tick bounds), grouped by the contract
 * holding it. Each row is the last admin event that set it; a guard no rate
 * limit lets act is not shown.
 */
export function PauParams({ snap, anchor }: { snap: StoredPauSnapshot; anchor: Anchor }) {
  const held = snap.contracts
    .map((c) => ({ c, rows: rowsOf(snap, c.params ?? []) }))
    .filter((x) => x.rows.length > 0)
    .sort((a, b) => contractLabel(a.c).localeCompare(contractLabel(b.c)) || a.c.address.localeCompare(b.c.address));
  if (held.length === 0) return null;
  return (
    <div className="mt-3">
      <PauSectionHeading deployment={anchor} section="parameters">Parameters</PauSectionHeading>
      <Callout className="mb-2">
        Each row is one setting this contract holds for a single pool, market, vault, token or destination, with the value from the most recent admin event that changed it. A max slippage or max exchange rate only matters while the operation it protects is allowed to run, so it is listed only when that address has a rate limit above zero for that operation. If the limit is zero, or no matching rate limit can be found, the setting is hidden.
      </Callout>
      {held.map(({ c, rows }) => <ContractParams key={c.address} c={c} rows={rows} chain={snap.chain} />)}
    </div>
  );
}
