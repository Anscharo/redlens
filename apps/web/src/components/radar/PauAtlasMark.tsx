import { AtlasLink } from "../AtlasLink";
import { useLoaded } from "../../hooks/useAtlasData";
import { entryOf, loadPauHistory, type LiveRateLimit } from "../../lib/pau";
import { unmatchedFlag } from "@/lib/pauAtlasFlag";
import type { AtlasVerdict } from "@/lib/pauAtlasMatch";
import { atlasOnchainHref } from "@/lib/routes";

const MARK = {
  match: { mark: "✓", text: "matches the atlas: every value the atlas states for this key matches the chain" },
  mismatch: { mark: "✗", text: "differs from the atlas: a value the atlas states for this key is not what the chain holds" },
  unsure: { mark: "?", text: "the atlas states a value for this key, but it cannot be told whether it matches" },
};

/** A limit no document is connected to: flagged by how it was set (pauAtlasFlag.ts); blank when it earns no flag. */
function UnmatchedFlag({ chain, limit }: { chain: string; limit: LiveRateLimit }) {
  const history = useLoaded(loadPauHistory, { soft: true });
  const origin = history ? entryOf(history, chain, limit.setAt.tx)?.origin?.kind : null;
  const off = (limit.data?.maxAmount ?? limit.configured.maxAmount) === "0";
  const flag = unmatchedFlag(origin, limit.setAt.time, off, Date.now());
  if (!flag) return null;
  return (
    <span role="img" aria-label={flag.text} title={flag.text} data-atlas-flag={flag.kind} style={{ color: flag.kind === "spell" ? "var(--accent)" : "var(--tan-3)" }}>
      ⚑
    </span>
  );
}

/** The Atlas column: the verdict's mark linked to the document's Onchain tab, else a flag where no document is connected and how the limit was set calls for one. */
export function PauAtlasMark({ verdict, chain, limit }: { verdict?: AtlasVerdict; chain: string; limit: LiveRateLimit }) {
  if (!verdict) return <UnmatchedFlag chain={chain} limit={limit} />;
  const { mark, text } = MARK[verdict.mark];
  return (
    <AtlasLink to={atlasOnchainHref(verdict.docId)} className="hover:underline" title={text} aria-label={text}>
      {mark}
    </AtlasLink>
  );
}
