import type { AddressInfo } from "@/types";
import type { ChainValue } from "../lib/chainstate";
import { chainValueRows } from "../lib/chainValueRows";
import { shortAddr } from "../lib/format";
import { Address } from "./Address";

const BADGE = "badge mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide";

/** The address's proxy badge (with its implementation) and role pills; nothing when it has neither. */
export function AddressCardBadges({ info }: { info: AddressInfo }) {
  const proxy = info.isProxy ? info.implementation : undefined;
  if (info.roles.length === 0 && !proxy) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-2">
      {proxy && (
        <span className={`${BADGE} badge-accent`} title={`implementation ${proxy}`}>
          proxy <span className="enlargen">→</span> {shortAddr(proxy)}
        </span>
      )}
      {info.roles.map((role) => (
        <span key={role} className={`${BADGE} badge-muted`}>
          {role}
        </span>
      ))}
    </div>
  );
}

/** The contract's view-function values read on chain, an address-valued one as an explorer link; nothing when none is worth showing. */
export function AddressCardChainValues({ chainValues, chain }: { chainValues: Record<string, ChainValue>; chain: string }) {
  const rows = chainValueRows(chainValues);
  if (rows.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[10px] mono mb-1 text-tan-3">on-chain · view functions</p>
      <div className="space-y-0.5">
        {rows.map(({ key, display, isAddress }) => (
          <div key={key} className="flex gap-2 items-baseline">
            <span className="chain-key mono text-[10px] shrink-0">{key}</span>
            {isAddress ? (
              <Address address={display} chain={chain} full className="text-[10px]" />
            ) : (
              <span className="mono text-[10px] break-all text-tan-2">{display}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
