import { AtlasLink } from "../AtlasLink";
import { Address } from "../Address";
import { atlasHref, atlasOnchainHref } from "@/lib/routes";
import { explorerTxUrl } from "@/lib/explorer";
import { PauAmount } from "./PauAmount";
import { PauOriginChip } from "./PauOriginChip";
import { anchorProps } from "./PauSectionHeading";
import { CopyLink } from "../CopyLink";
import { sectionAnchor, type Anchor } from "@/lib/pauAnchors";
import { matchId, type AtlasVerdict } from "@/lib/pauAtlasMatch";
import { formatAmount, formatPerDay, labelOnChain, limitDecimals, unitNote, type AtlasKeyRef, type DerivedKey, type LiveRateLimit } from "../../lib/pau";

/** A limit with the RateLimits contract holding it: two contracts of one deployment can hold the same key. */
export type ContractLimit = LiveRateLimit & { contract: string };

interface Props {
  chain: string;
  limits: ContractLimit[];
  keyIndex: Map<string, AtlasKeyRef[]>;
  /** The Atlas verdict of each contract and key pair (`matchId`) a document states a value for (pauAtlasMatch.ts). */
  verdicts: Map<string, AtlasVerdict>;
  /** The deployment's anchor; the table is `#<deployment>-rate-limits`. */
  anchor: Anchor;
}

const dim = { color: "var(--tan-3)" };
/** Column rule, fainter than the row rule so rows stay the primary rhythm. */
const colRule = { borderLeft: "1px solid color-mix(in srgb, var(--border) 45%, transparent)" };
const cell = "px-3 py-0.5 align-top";
const head = "px-3 pb-1 align-bottom font-normal leading-tight";
const isOff = (r: LiveRateLimit) => (r.data?.maxAmount ?? r.configured.maxAmount) === "0";

/**
 * Rows grouped by how the key is named, so siblings sit together: keys an atlas document states (linked), keys the
 * atlas names without a document, keys named by their controller constant, then unnamed keys. Within a group by name,
 * so `LIMIT_4626_DEPOSIT` across every vault is one run, then by derivation arguments; a switched-off key follows its
 * live siblings rather than leaving the group.
 */
function ordered<T extends LiveRateLimit>(limits: T[], keyIndex: Map<string, AtlasKeyRef[]>): T[] {
  const ref = (r: LiveRateLimit) => keyIndex.get(r.key.toLowerCase())?.[0];
  const tier = (r: LiveRateLimit) => (ref(r)?.docId ? 0 : ref(r) ? 1 : r.derived ? 2 : 3);
  const name = (r: LiveRateLimit) => ref(r)?.label ?? r.derived?.constant ?? r.key;
  const args = (r: LiveRateLimit) => r.derived?.args.join(" ") ?? "";
  return [...limits].sort(
    (a, b) => tier(a) - tier(b) || name(a).localeCompare(name(b)) || args(a).localeCompare(args(b)) || Number(isOff(a)) - Number(isOff(b)) || a.key.localeCompare(b.key),
  );
}

const derivation = (d: DerivedKey) => [d.constant, ...d.args].join(" · ");

/** A key no atlas doc states, named by the controller constant and arguments that derive it. */
function DerivedName({ k, d, chain }: { k: string; d: DerivedKey; chain: string }) {
  return (
    <span title={`${k}\nderived from ${derivation(d)}; no atlas document states this key`}>
      {d.constant}
      {d.args.map((a) => (
        <span key={a}>
          {" · "}
          {a.startsWith("0x") ? <Address address={a} chain={chain} noBalance /> : a}
        </span>
      ))}
    </span>
  );
}

/** A key's name: the atlas param that states it, else its derivation, else a note that nothing names it. */
export function LimitName({ r, chain, keyIndex }: { r: { key: string; derived?: DerivedKey }; chain: string; keyIndex: Map<string, AtlasKeyRef[]> }) {
  const refs = keyIndex.get(r.key.toLowerCase()) ?? [];
  const ref = refs[0];
  if (!ref && r.derived) return <DerivedName k={r.key} d={r.derived} chain={chain} />;
  if (!ref) {
    return (
      <span title={r.key} style={dim}>
        {r.key.slice(0, 10)}… <span style={{ color: "var(--accent)" }}>no document or controller constant found referencing this limit</span>
      </span>
    );
  }
  const label = labelOnChain(ref.label, chain) + (ref.via ? " (matched by address)" : "");
  const viaNote = ref.via ? [`the atlas lists ${ref.via} for this instance, and this key is derived from that address`] : [];
  const title = [r.key, ...viaNote, ...(r.derived ? [`derived from ${derivation(r.derived)}`] : []), ...refs.slice(1).map((x) => `also ${x.label}`)].join("\n");
  if (!ref.docId) return <span title={title}>{label}</span>;
  return (
    <AtlasLink to={atlasHref(ref.docId)} className="text-accent hover:underline" title={title}>
      {label}
    </AtlasLink>
  );
}

const MARK = {
  match: { mark: "✓", text: "matches the atlas: every value the atlas states for this key matches the chain" },
  mismatch: { mark: "✗", text: "differs from the atlas: a value the atlas states for this key is not what the chain holds" },
  unsure: { mark: "?", text: "the atlas states a value for this key, but it cannot be told whether it matches" },
};

/** The Atlas column: the verdict's mark, linked to the document's Onchain tab; blank when no document states a value for the key. */
function AtlasMark({ verdict }: { verdict?: AtlasVerdict }) {
  if (!verdict) return null;
  const { mark, text } = MARK[verdict.mark];
  return (
    <AtlasLink to={atlasOnchainHref(verdict.docId)} className="hover:underline" title={text} aria-label={text}>
      {mark}
    </AtlasLink>
  );
}

function LimitRow({ r, chain, keyIndex, verdict }: { r: LiveRateLimit; chain: string; keyIndex: Map<string, AtlasKeyRef[]>; verdict?: AtlasVerdict }) {
  const max = r.data?.maxAmount ?? r.configured.maxAmount;
  const dec = limitDecimals(r.unit, max);
  const scale = unitNote(r.unit, max) + (r.data ? "" : "; live read failed, showing the last value its history set");
  return (
    <tr className="border-t border-[var(--border)] mono" data-off={isOff(r) || undefined} style={{ color: isOff(r) ? "var(--tan-3)" : "var(--tan-2)" }}>
      <td className="py-0.5 pr-3 align-top max-w-[22rem] break-words"><LimitName r={r} chain={chain} keyIndex={keyIndex} /></td>
      <td className={`${cell} text-right`} style={colRule} title={scale}>{isOff(r) ? "off" : <PauAmount raw={max} dec={dec} symbol={r.unit?.symbol} />}</td>
      <td className={`${cell} text-right`} style={colRule} title={scale}>{formatPerDay(r.data?.slope ?? r.configured.slope, dec)}</td>
      <td className={`${cell} text-right`} style={colRule} title={scale}>{r.available === null ? "?" : formatAmount(r.available, dec)}</td>
      <td className={`${cell} text-center`} style={colRule} data-atlas-match={verdict?.mark}>
        <AtlasMark verdict={verdict} />
      </td>
      <td className={`${cell} text-right whitespace-nowrap`} style={colRule}>
        <a href={explorerTxUrl(chain, r.setAt.tx)} target="_blank" rel="noopener" className="hover:underline" style={dim}>
          {r.setAt.time.slice(0, 10)}
        </a>{" "}
        <PauOriginChip chain={chain} tx={r.setAt.tx} />
      </td>
    </tr>
  );
}

/** Every rate-limit key the contract has been given: on-chain maximum, slope (refill per day), and what is available now. */
export function PauRateLimits({ chain, limits, keyIndex, verdicts, anchor }: Props) {
  if (limits.length === 0) return null;
  const a = sectionAnchor(anchor, "rate-limits");
  return (
    <div className="relative mt-3">
      <CopyLink id={a.id} label={`${anchor.id} rate limits`} top={-2} />
      <table {...anchorProps(a)} className="border-collapse text-[12px]">
        <thead>
          <tr className="mono text-[11px] uppercase tracking-wider" style={dim}>
            <th className={`${head} pl-0 pr-3 text-left max-w-[22rem]`}>Rate limits</th>
            <th className={`${head} text-right normal-case`} style={colRule} title="the most the limit can hold">maxAmount</th>
            <th className={`${head} text-right`} style={colRule} title="how much the limit refills per day">Slope</th>
            <th className={`${head} text-right`} style={colRule} title="what can be used right now: the amount left after the last use, refilled at the slope since then, up to maxAmount">Available</th>
            <th className={`${head} text-center max-w-[5rem]`} style={colRule} title="✓ matches, ✗ differs, ? cannot be told; each links to the Atlas document stating the value. Blank when no document states one.">Matches Atlas</th>
            <th className={`${head} text-right`} style={colRule}>Last updated</th>
          </tr>
        </thead>
        <tbody>
          {ordered(limits, keyIndex).map((r) => (
            <LimitRow key={`${r.contract}:${r.key}`} r={r} chain={chain} keyIndex={keyIndex} verdict={verdicts.get(matchId(r.contract, r.key))} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
