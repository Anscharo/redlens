import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { formatAmount, keysFromAddress, limitDecimals, listedAddress, loadPau, snapshotsForPrime } from "../../lib/pau";
import { RADAR_SECTION } from "@/lib/radarAnchors";

interface Props {
  primeId: string;
  paramKey: string;
  value: string;
}

/**
 * Under a RateLimitID param that lists an address instead of a hash, the
 * prime's on-chain keys derived from that address, linked to the PAU section
 * that shows their values.
 */
export function ParamAddressKeys({ primeId, paramKey, value }: Props) {
  const res = useLoaded(loadPau, { soft: true });
  const via = listedAddress(paramKey, value);
  const matches = useMemo(() => (res && via ? keysFromAddress(snapshotsForPrime(res, primeId), via) : []), [res, via, primeId]);
  if (matches.length === 0) return null;
  return (
    <ul className="mono text-[10px] mb-1 pl-3" style={{ color: "var(--tan-3)" }} aria-label="On-chain keys derived from this address">
      {matches.map((m) => (
        <li key={`${m.chain}:${m.key}`} title={`${m.key}\nderived from ${[m.derived.constant, ...m.derived.args].join(" · ")}`}>
          on-chain key{" "}
          <a href={`#${RADAR_SECTION.pau}`} className="hover:underline" style={{ color: "var(--accent)" }}>
            {m.key.slice(0, 10)}…{m.key.slice(-4)}
          </a>
          {` · ${m.derived.constant} · ${m.chain} · ${m.maxAmount === "0" ? "off" : `${formatAmount(m.maxAmount, limitDecimals(m.unit, m.maxAmount))}${m.unit?.symbol ? ` ${m.unit.symbol}` : ""}`}`}
        </li>
      ))}
    </ul>
  );
}
