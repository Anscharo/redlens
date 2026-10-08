import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { formatAmount, keysFromAddress, limitDecimals, listedAddress, loadPau, snapshotsForPrime } from "../../lib/pau";
import { actorPageHref } from "@/lib/routes";
import { Link } from "../Link";

/** The prime whose page this is: its id keys the PAU snapshots, its slug
 *  names its PAUs page. */
export type PauPrime = { id: string; slug: string };

interface Props {
  prime: PauPrime;
  paramKey: string;
  value: string;
}

/**
 * Under a RateLimitID param that lists an address instead of a hash, the
 * prime's on-chain keys derived from that address, linked to the prime's PAUs
 * page, which shows their values.
 */
export function ParamAddressKeys({ prime, paramKey, value }: Props) {
  const res = useLoaded(loadPau, { soft: true });
  const via = listedAddress(paramKey, value);
  const matches = useMemo(() => (res && via ? keysFromAddress(snapshotsForPrime(res, prime.id), via) : []), [res, via, prime.id]);
  if (matches.length === 0) return null;
  return (
    <ul className="mono text-[10px] mb-1 pl-3" style={{ color: "var(--tan-3)" }} aria-label="On-chain keys derived from this address">
      {matches.map((m) => (
        <li key={`${m.chain}:${m.key}`} title={`${m.key}\nderived from ${[m.derived.constant, ...m.derived.args].join(" · ")}`}>
          on-chain key{" "}
          <Link to={actorPageHref(prime.slug, "pau")} className="hover:underline" style={{ color: "var(--accent)" }}>
            {m.key.slice(0, 10)}…{m.key.slice(-4)}
          </Link>
          {` · ${m.derived.constant} · ${m.chain} · ${m.maxAmount === "0" ? "off" : `${formatAmount(m.maxAmount, limitDecimals(m.unit, m.maxAmount))}${m.unit?.symbol ? ` ${m.unit.symbol}` : ""}`}`}
        </li>
      ))}
    </ul>
  );
}
