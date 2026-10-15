import { explorerTxUrl } from "@/lib/explorer";
import { PauAmount } from "./PauAmount";
import { PauOriginChip } from "./PauOriginChip";
import { anchorProps } from "./PauSectionHeading";
import { CopyLink } from "../CopyLink";
import { sectionAnchor, type Anchor } from "@/lib/pauAnchors";
import { elsewhereId, matchId, type AtlasVerdict } from "@/lib/pauAtlasMatch";
import { PauAtlasMark } from "./PauAtlasMark";
import { rowMark } from "@/lib/pauAtlasMatch";
import { isOff, orderedLimits } from "@/lib/pauLimitOrder";
import type { NamedIn } from "@/lib/pauConstantDocs";
import { PauLimitName } from "./PauLimitName";
import { formatPerDay, limitDecimals, unitNote, type AtlasKeyRef, type LiveRateLimit } from "../../lib/pau";

/** A limit with the RateLimits contract holding it: two contracts of one deployment can hold the same key. */
export type ContractLimit = LiveRateLimit & { contract: string };

interface Props {
  chain: string;
  limits: ContractLimit[];
  keyIndex: Map<string, AtlasKeyRef[]>;
  /** The document a limit's controller constant is named in (pauConstantDocs.ts). */
  namedIn?: NamedIn;
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

function LimitRow({ r, chain, keyIndex, namedIn, verdict, elsewhere }: { r: LiveRateLimit; chain: string; keyIndex: Map<string, AtlasKeyRef[]>; namedIn?: NamedIn; verdict?: AtlasVerdict; elsewhere?: AtlasVerdict }) {
  const { shown, keyDocId } = rowMark(verdict, elsewhere, chain, keyIndex.get(r.key.toLowerCase()) ?? []);
  const max = r.data?.maxAmount ?? r.configured.maxAmount;
  const dec = limitDecimals(r.unit, max);
  const scale = unitNote(r.unit, max) + (r.data ? "" : "; live read failed, showing the last value its history set");
  return (
    <tr className="border-t border-[var(--border)] mono" data-off={isOff(r) || undefined} style={{ color: isOff(r) ? "var(--tan-3)" : "var(--tan-2)" }}>
      <td className="py-0.5 pr-3 align-top max-w-[40rem] break-words"><PauLimitName r={r} chain={chain} keyIndex={keyIndex} namedIn={namedIn} /></td>
      <td className={`${cell} text-right`} style={colRule} title={scale}>{isOff(r) ? "off" : <PauAmount raw={max} dec={dec} symbol={r.unit?.symbol} />}</td>
      <td className={`${cell} text-right`} style={colRule} title={scale}>{formatPerDay(r.data?.slope ?? r.configured.slope, dec)}</td>
      <td className={`${cell} text-center`} style={colRule} data-atlas-match={shown?.mark}>
        <PauAtlasMark verdict={shown} keyDocId={keyDocId} chain={chain} limit={r} />
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

/** Every rate-limit key the contract has been given: on-chain maxAmount and slope (refill per day). */
export function PauRateLimits({ chain, limits, keyIndex, namedIn, verdicts, anchor }: Props) {
  if (limits.length === 0) return null;
  const a = sectionAnchor(anchor, "rate-limits");
  return (
    <div className="relative mt-3">
      <CopyLink id={a.id} label={`${anchor.id} rate limits`} top={-2} />
      <table {...anchorProps(a)} className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="mono text-[11px] uppercase tracking-wider" style={dim}>
            <th className={`${head} pl-0 pr-3 text-left max-w-[40rem]`}>Rate limits</th>
            <th className={`${head} text-right normal-case`} style={colRule} title="the most the limit can hold">maxAmount</th>
            <th className={`${head} text-right`} style={colRule} title="how much the limit refills per day">Slope</th>
            <th className={`${head} text-center max-w-[5rem]`} style={colRule} title="✓ matches, ✗ differs, ? cannot be told, or the Atlas states the value only for another deployment; each links to the Atlas document stating the value. Blank when no document states one.">Matches Atlas</th>
            <th className={`${head} text-right`} style={colRule}>Last updated</th>
          </tr>
        </thead>
        <tbody>
          {orderedLimits(limits, keyIndex, isOff).map((r) => (
            <LimitRow key={`${r.contract}:${r.key}`} r={r} chain={chain} keyIndex={keyIndex} namedIn={namedIn} verdict={verdicts.get(matchId(r.contract, r.key))} elsewhere={verdicts.get(elsewhereId(r.key))} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
