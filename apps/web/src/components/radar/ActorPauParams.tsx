import { Address } from "../Address";
import { AtlasLink } from "../AtlasLink";
import { Callout } from "../Callout";
import { atlasHref } from "@/lib/routes";
import type { ContractState, PauParam, StoredPauSnapshot } from "../../lib/pau";
import type { Anchor } from "@/lib/pauAnchors";
import { contractLabel } from "@/lib/pauHolderNames";
import { paramTarget, paramTitle } from "@/lib/pauParamText";
import { isGuardParam, paramUse, type ParamUse } from "@/lib/pauParamUse";
import { PauParamRow } from "./ActorPauParamRow";
import { PauSectionHeading } from "./PauSectionHeading";

type Row = { p: PauParam; use: ParamUse | null };

/** The atlas document defining the PAU's parameters, max slippage among them (A.2.2.10.1.1.1.2.1). */
const PARAM_DEFINITIONS_DOC = "a8a3e54d-18f0-451c-8ff0-4a66094650ae";

/** A setting's identity in the list: its event and subject, and the asset where an OTC exchange whitelists each asset on its own (as the server's settingKey keys it). */
const rowKey = ({ p }: Row) => `${p.event}:${p.subject}:${typeof p.args.asset === "string" ? p.args.asset : ""}`;

const rowName = ({ p, use }: Row) => `${paramTitle(p.event)} ${use?.kind ?? ""} ${paramTarget(p.event, p.subject) ?? p.subjectToken?.symbol ?? p.subject}`;

/** A contract's settings that act, by what they are called, what they are set on and its name. A guard no rate limit lets act is left out (pauParamUse.ts). */
function rowsOf(snap: StoredPauSnapshot, params: PauParam[]): Row[] {
  const rows = params.map((p) => ({ p, use: isGuardParam(p.event) ? paramUse(snap, p) : null })).filter((r) => !r.use || r.use.state === "on");
  return rows.sort((a, b) => rowName(a).localeCompare(rowName(b), "en", { numeric: true }) || rowKey(a).localeCompare(rowKey(b)));
}

/** One contract's settings that act. */
function ContractParams({ c, rows, chain }: { c: ContractState; rows: Row[]; chain: string }) {
  return (
    <section className="mb-2" data-contract={c.address}>
      <h5 className="mono text-[11px] flex items-baseline gap-2" style={{ color: "var(--tan)" }}>
        {contractLabel(c)} <Address address={c.address} chain={chain} noBalance />
      </h5>
      <ul className="space-y-0.5 pl-3">
        {rows.map((r) => <PauParamRow key={rowKey(r)} p={r.p} chain={chain} use={r.use} />)}
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
        Each row is a setting for one pool, market, vault, token or destination, at its latest value. Max slippage and max exchange rate are shown only where a rate limit above zero lets them apply. The atlas defines these parameters in{" "}
        <AtlasLink to={atlasHref(PARAM_DEFINITIONS_DOC)} className="text-accent hover:underline">Liquidity Layer Parameter Definitions</AtlasLink>.
      </Callout>
      {held.map(({ c, rows }) => <ContractParams key={c.address} c={c} rows={rows} chain={snap.chain} />)}
    </div>
  );
}
