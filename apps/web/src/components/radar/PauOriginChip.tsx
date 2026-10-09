import { useLoaded } from "../../hooks/useAtlasData";
import { chipText, entryOf, loadPauHistory, txAnchor } from "../../lib/pau";

/**
 * Where the value beside it was set from: an executive, a relayed action set,
 * an operator, a deployment. Links to that transaction's row in the change
 * history; absent until the history loads or when it holds no such row.
 */
export function PauOriginChip({ chain, tx }: { chain: string; tx: string }) {
  const res = useLoaded(loadPauHistory, { soft: true });
  const entry = res ? entryOf(res, chain, tx) : undefined;
  if (!entry) return null;
  const title = [entry.executive?.title, entry.origin?.evidence].filter(Boolean).join("\n");
  return (
    <a
      href={`#${txAnchor(chain, tx)}`}
      className="pau-origin-chip mono text-[9px] px-1 rounded hover:underline whitespace-nowrap"
      data-kind={entry.origin?.kind ?? "pending"}
      title={title || undefined}
      style={{ border: "1px solid var(--border)", color: "var(--tan-2)" }}
    >
      {chipText(entry)}
    </a>
  );
}
