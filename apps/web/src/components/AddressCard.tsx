import type { AddressInfo } from "@/types";
import type { ChainValue } from "../lib/chainstate";
import { EVM_ADDRESS_EXACT_RE } from "@/lib/patterns";
import { shortAddr } from "../lib/format";
import { Address } from "./Address";
import { resolveAddressName, resolveOwner, hasResolvedName } from "../lib/addressName";
import { resolveAddressTooltip } from "../lib/addressTooltip";
import { useSharedBalances } from "../lib/sharedBalances";

function formatValue(val: ChainValue): string {
  if (val === null) return "—";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.map(formatValue).join(", ");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function isSkippable(key: string, val: ChainValue): boolean {
  if (val === null) return true;
  if (val === "0x0000000000000000000000000000000000000000") return true;
  if (val === "") return true;
  if (key === "DOMAIN_SEPARATOR" || key === "PERMIT_TYPEHASH") return true;
  return false;
}

export function AddressCard({
  address,
  info,
  chainValues,
  byName = false,
}: {
  address: string;
  info: AddressInfo;
  chainValues?: Record<string, ChainValue>;
  /** This section named the address only by its chainlog key, not a 0x literal. */
  byName?: boolean;
}) {
  const { addresses } = useSharedBalances(true);
  const name = resolveAddressName(address, info);
  const owner = resolveOwner(info);
  const { held } = resolveAddressTooltip(address, { [address]: info }, addresses);
  const visibleChainValues = chainValues
    ? Object.entries(chainValues).filter(([k, v]) => !isSkippable(k, v))
    : [];

  return (
    <div className="py-3 border-b border-border">
      {/* Only show a bold name when it's an authoritative identifier — otherwise
          it would just repeat the address shown on the explorer line below. */}
      {hasResolvedName(info) && <p className="text-sm font-semibold mb-1 text-tan">{name}</p>}
      {owner && <p className="text-xs mb-1 text-tan-2">{owner}</p>}
      {byName && info.chainlogId && (
        <p className="text-[10px] mono mb-1 text-tan-3">referenced by chainlog name · {info.chainlogId}</p>
      )}
      {info.aliases.length > 0 && (
        <p className="text-xs mb-1 text-tan-3">also known as {info.aliases.join(" · ")}</p>
      )}
      {/* The card already shows this address's name, owner and balances, so its
          own address line skips the (redundant) balance hover. */}
      <Address address={address} chain={info.chain} full noTooltip className="text-xs block mb-2" />

      {(info.roles.length > 0 || (info.isProxy && info.implementation)) && (
        <div className="flex flex-wrap gap-1 mb-2">
          {info.isProxy && info.implementation && (
            <span
              className="badge badge-accent mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide"
              title={`implementation ${info.implementation}`}
            >
              proxy <span className="enlargen">→</span> {shortAddr(info.implementation)}
            </span>
          )}
          {info.roles.map((role) => (
            <span
              key={role}
              className="badge badge-muted mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide"
            >
              {role}
            </span>
          ))}
        </div>
      )}

      {held.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] mono mb-1 text-tan-3">holds</p>
          <div className="space-y-0.5">
            {held.map((h) => (
              <div key={`${h.symbol}-${h.chain ?? ""}`} className="flex justify-between gap-3 mono text-[11px] text-tan-2">
                <span>
                  {h.symbol}
                  {h.chain ? ` (${h.chain})` : ""}
                </span>
                <span>{h.amount}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {visibleChainValues.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] mono mb-1 text-tan-3">on-chain · view functions</p>
          <div className="space-y-0.5">
            {visibleChainValues.map(([key, val]) => {
              const display = formatValue(val);
              const isAddr = typeof val === "string" && EVM_ADDRESS_EXACT_RE.test(val);
              return (
                <div key={key} className="flex gap-2 items-baseline">
                  <span className="chain-key mono text-[10px] shrink-0">{key}</span>
                  {isAddr ? (
                    <Address address={display} chain={info.chain} full className="text-[10px]" />
                  ) : (
                    <span className="mono text-[10px] break-all text-tan-2">{display}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
