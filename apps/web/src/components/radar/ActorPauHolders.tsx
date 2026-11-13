import { AtlasLink } from "../AtlasLink";
import { Callout } from "../Callout";
import { atlasHref } from "@/lib/routes";
import { holderRows, type HolderStatus, type PauSnapshot } from "../../lib/pau";
import type { Anchor } from "@/lib/pauAnchors";
import { contractLabel, holderNames } from "@/lib/pauHolderNames";
import { PLUMBING } from "@/lib/pauPlumbing";
import { entityLink, plumbLitTint, rowLinker } from "@/lib/pauPlumbingLinks";
import { HolderName } from "./PauHolderName";
import { PauOriginChip } from "./PauOriginChip";
import { PauSectionHeading } from "./PauSectionHeading";
import { MARK_TIP_MS } from "./PauAtlasMark";
import { Tooltip } from "../Tooltip";

const STATUS: Record<HolderStatus, { mark: string; color: string; role: string; member: string }> = {
  holds: { mark: "✓", color: "var(--tan-2)", role: "holds the role", member: "the AdministeredAgent lists it" },
  denied: { mark: "✗", color: "var(--accent)", role: "granted in the history but the chain says it does not hold the role", member: "added in the history but the AdministeredAgent no longer lists it" },
  unread: { mark: "?", color: "var(--tan-3)", role: "hasRole could not be read", member: "membership could not be read" },
};

/** The atlas document defining the Diamond PAU's access-control roles (A.2.2.10.1.1.1.2.2). */
const ROLE_DEFINITIONS_DOC = "2ae4b91a-6900-41e8-9718-32805b956550";

/** What a role is, with the main ones and the atlas's role definitions. */
const RolesNote = () => (
  <Callout className="mb-2">
    A role is a permission built into a contract: only an address holding it can call the functions it guards. The admin, Sky governance, grants and
    removes every other role. The relayer, an off-chain bot, moves funds through the controller within its rate limits, and the freezer can cut a
    relayer off in an emergency. More in the atlas&apos;s{" "}
    <AtlasLink to={atlasHref(ROLE_DEFINITIONS_DOC)} className="text-accent hover:underline">Liquidity Layer Role Definitions</AtlasLink>.
  </Callout>
);

/** The tint a row part takes while lit (pauPlumbingLinks.ts). */
const lit = { background: plumbLitTint("transparent") };

const VERB = { role: { denied: "was granted", else: "holds" }, member: { denied: "was added as", else: "is" } };

/** What a row says its role is held on: the contract's name in the deployment's contract list, so "on ALM proxy (freezable)" names the one listed. */
function onLabeller(snap: PauSnapshot) {
  const byAddress = new Map(snap.contracts.map((c) => [c.address.toLowerCase(), c]));
  return (on: string, contract: string) => {
    const c = byAddress.get(contract.toLowerCase());
    return c ? contractLabel(c) : on;
  };
}

/** Who holds which role on which PAU contract, each marked as the chain confirms it. */
export function PauHolders({ snap, anchor }: { snap: PauSnapshot; anchor: Anchor }) {
  const rows = holderRows(snap);
  if (rows.length === 0) return null;
  const names = holderNames(snap);
  const links = rowLinker(snap, PLUMBING[snap.kind]);
  const onLabel = onLabeller(snap);
  return (
    <div className="mt-3">
      <PauSectionHeading deployment={anchor} section="roles">Roles</PauSectionHeading>
      <RolesNote />
      <ul className="space-y-0.5">
        {rows.map((r) => {
          const s = STATUS[r.status];
          const text = s[r.check];
          const l = links(r);
          return (
            <li key={`${r.contract}:${r.name}:${r.account}`} className="mono text-[11px] flex flex-wrap items-baseline gap-x-2" data-status={r.status}>
              <Tooltip content={text} delay={MARK_TIP_MS}>
                <span role="img" style={{ color: s.color }} aria-label={text}>{s.mark}</span>
              </Tooltip>
              <HolderName name={names.get(r.account.toLowerCase())} link={l.holder} account={r.account} chain={snap.chain} />
              <span className="rounded" style={lit} data-link={l.grant} data-part="grant">
                <span style={{ color: "var(--tan-3)" }}>{VERB[r.check][r.status === "denied" ? "denied" : "else"]}</span> <span style={{ color: "var(--tan-2)" }}>{r.name}</span>
              </span>
              <span style={{ color: "var(--tan-3)" }}>
                on <span className="rounded" style={lit} data-link={l.on} data-ent={entityLink(r.contract)} data-part="on">{onLabel(r.on, r.contract)}</span>
              </span>
              <span style={{ color: "var(--tan-3)" }}>{r.since ? `since ${r.since.time.slice(0, 10)}` : "not in the stored history"}</span>
              {r.since && <PauOriginChip chain={snap.chain} tx={r.since.tx} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
