import { useState, type ReactNode } from "react";
import { explorerTxUrl } from "@/lib/explorer";
import { useLoaded } from "../../hooks/useAtlasData";
import { PauAmount } from "./PauAmount";
import { PauOriginChip } from "./PauOriginChip";
import { PauSectionHeading } from "./PauSectionHeading";
import { colRule, PauRateLimitsHead } from "./PauRateLimitsHead";
import type { Anchor } from "@/lib/pauAnchors";
import { elsewhereId, matchId, rowMark, type AtlasVerdict } from "@/lib/pauAtlasMatch";
import { unmatchedFlag } from "@/lib/pauAtlasFlag";
import { PauAtlasMark } from "./PauAtlasMark";
import { isOff, limitName, orderedLimits } from "@/lib/pauLimitOrder";
import { atlasRank, nextSort, sortLimits, type LimitSort } from "@/lib/pauLimitSort";
import { rowNamedIn, type NamedIn } from "@/lib/pauConstantDocs";
import { PauLimitName } from "./PauLimitName";
import { entryOf, formatPerDay, limitDecimals, loadPauHistory, unitNote, type AtlasKeyRef, type LiveRateLimit, type PauHistoryResponse } from "../../lib/pau";

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
  /** The deployment's anchor; the section is `#<deployment>-rate-limits`. */
  anchor: Anchor;
  /** Shown under the heading, above the table: the deployment's values to review. */
  review?: ReactNode;
}

/** A row with what its Atlas cell shows and the name and rank it sorts by. */
interface Row {
  r: ContractLimit;
  shown?: AtlasVerdict;
  keyDocId?: string | null;
  named: boolean;
  name: string;
  atlas: number;
}

const dim = { color: "var(--tan-3)" };
const cell = "px-3 py-0.5 align-top";

function LimitRow({ row: { r, shown, keyDocId, named }, chain, keyIndex, namedIn }: { row: Row; chain: string; keyIndex: Map<string, AtlasKeyRef[]>; namedIn?: NamedIn }) {
  const max = r.data?.maxAmount ?? r.configured.maxAmount;
  const dec = limitDecimals(r.unit, max);
  const scale = unitNote(r.unit, max) + (r.data ? "" : "; live read failed, showing the last value its history set");
  return (
    <tr className="border-t border-[var(--border)] mono" data-off={isOff(r) || undefined} style={{ color: isOff(r) ? "var(--tan-3)" : "var(--tan-2)" }}>
      <td className="py-0.5 pr-3 align-top max-w-[40rem] break-words"><PauLimitName r={r} chain={chain} keyIndex={keyIndex} namedIn={namedIn} /></td>
      <td className={`${cell} text-right`} style={colRule} title={scale}>{isOff(r) ? "off" : <PauAmount raw={max} dec={dec} symbol={r.unit?.symbol} />}</td>
      <td className={`${cell} text-right`} style={colRule} title={scale}>{formatPerDay(r.data?.slope ?? r.configured.slope, dec)}</td>
      <td className={`${cell} text-center`} style={colRule} data-atlas-match={shown?.mark}>
        <PauAtlasMark verdict={shown} keyDocId={keyDocId} chain={chain} limit={r} named={named} />
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

/** Each limit in the table's default order with its Atlas cell and sort values; a flag (⚑) is read from the change history as PauAtlasMark reads it. */
function tableRows({ chain, limits, keyIndex, namedIn, verdicts }: Props, history: PauHistoryResponse | null): Row[] {
  return orderedLimits(limits, keyIndex, isOff).map((r) => {
    const refs = keyIndex.get(r.key.toLowerCase()) ?? [];
    const { shown, keyDocId } = rowMark(verdicts.get(matchId(r.contract, r.key)), verdicts.get(elsewhereId(r.key)), chain, refs);
    const named = !!rowNamedIn(r, chain, refs, namedIn);
    const origin = history ? entryOf(history, chain, r.setAt.tx)?.origin?.kind : null;
    const flagged = !!unmatchedFlag(origin, r.setAt.time, isOff(r), Date.now(), named);
    return { r, shown, keyDocId, named, name: limitName(r, keyIndex), atlas: atlasRank(shown, keyDocId, flagged) };
  });
}

/** Every rate-limit key the contract has been given: on-chain maxAmount and slope (refill per day), sortable by each column. Without any, the heading and the values to review still show. */
export function PauRateLimits(props: Props) {
  const { chain, limits, keyIndex, namedIn, anchor, review } = props;
  const [sort, setSort] = useState<LimitSort | null>(null);
  const history = useLoaded(loadPauHistory, { soft: true });
  return (
    <section className="mt-3">
      <PauSectionHeading deployment={anchor} section="rate-limits">Rate limits</PauSectionHeading>
      {review && <p className="text-[12px] mb-1" style={dim}>{review}</p>}
      {limits.length === 0 ? <p className="mono text-[11px]" style={dim}>No rate-limit key read for this deployment.</p> : <table className="w-full border-collapse text-[12px]">
        <PauRateLimitsHead sort={sort} onSort={(by) => setSort((s) => nextSort(s, by))} />
        <tbody>
          {sortLimits(tableRows(props, history), sort).map((row) => (
            <LimitRow key={`${row.r.contract}:${row.r.key}`} row={row} chain={chain} keyIndex={keyIndex} namedIn={namedIn} />
          ))}
        </tbody>
      </table>}
    </section>
  );
}
