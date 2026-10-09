import { explorerTxUrl } from "@/lib/explorer";
import { routeText, txAnchor, type AtlasKeyRef, type PauHistoryEntry } from "../../lib/pau";
import { PauChangeLine } from "./PauChangeLine";

const dim = { color: "var(--tan-3)" };
const chainLabel = (chain: string) => chain.charAt(0).toUpperCase() + chain.slice(1);

/** One transaction's changes: its chain, date and route, then each value it set. */
export function PauTimelineEntry({ e, keyIndex }: { e: PauHistoryEntry; keyIndex: Map<string, AtlasKeyRef[]> }) {
  return (
    <li id={txAnchor(e.chain, e.tx)} className="pau-timeline-entry pt-1" style={{ scrollMarginTop: "64px" }} data-chain={e.chain}>
      <p className="mono text-[10px] flex flex-wrap gap-x-2" style={dim}>
        <span style={{ color: "var(--tan)" }}>{chainLabel(e.chain)}</span>
        <a href={explorerTxUrl(e.chain, e.tx)} target="_blank" rel="noopener" className="hover:underline" title={e.tx}>
          {e.time.slice(0, 16).replace("T", " ")} UTC
        </a>
        <span title={e.origin?.evidence}>{routeText(e.origin, e.chain)}</span>
      </p>
      <ul className="pl-3 space-y-0.5">
        {e.changes.map((c, i) => (
          <PauChangeLine key={`${c.contract}:${i}`} c={c} chain={e.chain} keyIndex={keyIndex} />
        ))}
      </ul>
    </li>
  );
}
