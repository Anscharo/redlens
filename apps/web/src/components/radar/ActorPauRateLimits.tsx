import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { explorerTxUrl } from "@/lib/explorer";
import { formatAmount, formatPerDay, inferDecimals, labelOnChain, type AtlasKeyRef, type LiveRateLimit } from "../../lib/pau";

interface Props {
  chain: string;
  limits: LiveRateLimit[];
  keyIndex: Map<string, AtlasKeyRef[]>;
}

const dim = { color: "var(--tan-3)" };
const isOff = (r: LiveRateLimit) => (r.data?.maxAmount ?? r.configured.maxAmount) === "0";

/** Limits the atlas names first, by name; unnamed keys after; switched-off keys last. */
function ordered(limits: LiveRateLimit[], keyIndex: Map<string, AtlasKeyRef[]>) {
  const label = (r: LiveRateLimit) => keyIndex.get(r.key.toLowerCase())?.[0]?.label ?? "￿";
  return [...limits].sort((a, b) => Number(isOff(a)) - Number(isOff(b)) || label(a).localeCompare(label(b)));
}

function LimitName({ r, chain, keyIndex }: { r: LiveRateLimit; chain: string; keyIndex: Map<string, AtlasKeyRef[]> }) {
  const refs = keyIndex.get(r.key.toLowerCase()) ?? [];
  const ref = refs[0];
  if (!ref) {
    return (
      <span title={r.key} style={dim}>
        {r.key.slice(0, 10)}… <span style={{ color: "var(--accent)" }}>no document found referencing this limit</span>
      </span>
    );
  }
  const label = labelOnChain(ref.label, chain);
  const title = [r.key, ...refs.slice(1).map((x) => `also ${x.label}`)].join("\n");
  if (!ref.docId) return <span title={title}>{label}</span>;
  return (
    <AtlasLink to={atlasHref(ref.docId)} className="text-accent hover:underline" title={title}>
      {label}
    </AtlasLink>
  );
}

function LimitRow({ r, chain, keyIndex }: { r: LiveRateLimit; chain: string; keyIndex: Map<string, AtlasKeyRef[]> }) {
  const max = r.data?.maxAmount ?? r.configured.maxAmount;
  const dec = inferDecimals(max);
  const scale = `${dec} decimals, inferred from the limit's size`;
  return (
    <tr className="border-t border-[var(--border)] mono" data-off={isOff(r) || undefined} style={{ color: isOff(r) ? "var(--tan-3)" : "var(--tan-2)" }}>
      <td className="py-0.5 pr-3"><LimitName r={r} chain={chain} keyIndex={keyIndex} /></td>
      <td className="py-0.5 text-right" title={scale}>{isOff(r) ? "off" : formatAmount(max, dec)}</td>
      <td className="py-0.5 text-right" title={scale}>{formatPerDay(r.data?.slope ?? r.configured.slope, dec)}</td>
      <td className="py-0.5 text-right" title={scale}>{r.available === null ? "?" : formatAmount(r.available, dec)}</td>
      <td className="py-0.5 text-right">
        <a href={explorerTxUrl(chain, r.setAt.tx)} target="_blank" rel="noopener" className="hover:underline" style={dim}>
          {r.setAt.time.slice(0, 10)}
        </a>
      </td>
    </tr>
  );
}

/** Every rate-limit key the contract has been given: on-chain maximum, refill per day, and what is available now. */
export function PauRateLimits({ chain, limits, keyIndex }: Props) {
  if (limits.length === 0) return null;
  return (
    <table className="w-full border-collapse mt-3 text-[11px]">
      <thead>
        <tr className="mono text-[10px] uppercase tracking-wider" style={dim}>
          <th className="text-left font-normal pb-1">Rate limit</th>
          <th className="text-right font-normal pb-1">Max</th>
          <th className="text-right font-normal pb-1">Per day</th>
          <th className="text-right font-normal pb-1">Available</th>
          <th className="text-right font-normal pb-1">Set</th>
        </tr>
      </thead>
      <tbody>
        {ordered(limits, keyIndex).map((r) => (
          <LimitRow key={r.key} r={r} chain={chain} keyIndex={keyIndex} />
        ))}
      </tbody>
    </table>
  );
}
