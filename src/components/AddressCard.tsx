import type { AddressInfo } from "../types";
import type { ChainValue } from "../lib/chainstate";

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
}: {
  address: string;
  info: AddressInfo;
  chainValues?: Record<string, ChainValue>;
}) {
  const visibleChainValues = chainValues
    ? Object.entries(chainValues).filter(([k, v]) => !isSkippable(k, v))
    : [];

  return (
    <div className="py-3 border-b border-border">
      {info.label && (
        <p className="text-sm font-semibold mb-1 text-tan">{info.label}</p>
      )}
      {info.aliases.length > 0 && (
        <p className="text-xs mb-1 text-tan-3">
          also known as {info.aliases.join(" · ")}
        </p>
      )}
      <a
        href={info.explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="link-accent mono text-xs block mb-2 break-all"
      >
        {address}
      </a>

      {(info.roles.length > 0 || (info.isProxy && info.implementation)) && (
        <div className="flex flex-wrap gap-1 mb-2">
          {info.isProxy && info.implementation && (
            <span
              className="badge badge-accent mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide"
              title={`implementation ${info.implementation}`}
            >
              proxy → {info.implementation.slice(0, 6)}…{info.implementation.slice(-4)}
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

      {visibleChainValues.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] mono mb-1 text-tan-3">on-chain · view functions</p>
          <div className="space-y-0.5">
            {visibleChainValues.map(([key, val]) => {
              const display = formatValue(val);
              const isAddr = typeof val === "string" && /^0x[0-9a-fA-F]{40}$/.test(val);
              return (
                <div key={key} className="flex gap-2 items-baseline">
                  <span className="chain-key mono text-[10px] shrink-0">{key}</span>
                  {isAddr ? (
                    <a
                      href={`https://etherscan.io/address/${val}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-accent mono text-[10px] break-all"
                      style={{ textUnderlineOffset: "2px" }}
                    >
                      {display}
                    </a>
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
