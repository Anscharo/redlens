import { AtlasLink } from "../AtlasLink";
import { Tooltip } from "../Tooltip";
import { useLoaded } from "../../hooks/useAtlasData";
import { entryOf, loadPauHistory, type LiveRateLimit } from "../../lib/pau";
import { unmatchedFlag } from "@/lib/pauAtlasFlag";
import type { AtlasVerdict } from "@/lib/pauAtlasMatch";
import { atlasOnchainHref } from "@/lib/routes";
import { PAU_KIND_LABEL } from "@/lib/pau";

/** How long the pointer rests on a mark (✓ ✗ ? ⚑) before its tooltip opens. */
export const MARK_TIP_MS = 600;

const MARK: Record<Exclude<AtlasVerdict["mark"], "elsewhere">, { mark: string; text: string }> = {
  match: { mark: "✓", text: "matches the atlas: every value the atlas states for this key matches the chain" },
  mismatch: { mark: "✗", text: "differs from the atlas: a value the atlas states for this key is not what the chain holds" },
  unsure: { mark: "?", text: "the atlas states a value for this key, but it cannot be told whether it matches" },
};

/** A limit no document is connected to: flagged by how it was set (pauAtlasFlag.ts); blank when it earns no flag. */
function UnmatchedFlag({ chain, limit, named }: { chain: string; limit: LiveRateLimit; named?: boolean }) {
  const history = useLoaded(loadPauHistory, { soft: true });
  const origin = history ? entryOf(history, chain, limit.setAt.tx)?.origin?.kind : null;
  const off = (limit.data?.maxAmount ?? limit.configured.maxAmount) === "0";
  const flag = unmatchedFlag(origin, limit.setAt.time, off, Date.now(), named);
  if (!flag) return null;
  return (
    <Tooltip content={flag.text} delay={MARK_TIP_MS}>
      <span role="img" aria-label={flag.text} data-atlas-flag={flag.kind} style={{ color: flag.kind === "spell" ? "var(--accent)" : "var(--tan-3)" }}>
        ⚑
      </span>
    </Tooltip>
  );
}

/** "arbitrum diamond" → "the Arbitrum Diamond PAU". */
function deploymentName(where: string): string {
  const [chain, kind] = where.split(" ");
  return `the ${chain[0].toUpperCase()}${chain.slice(1)} ${PAU_KIND_LABEL[kind as keyof typeof PAU_KIND_LABEL] ?? kind}`;
}

const elsewhereText = (on: string[]) => `the Atlas states a value for this key only for ${on.map(deploymentName).join(" and ")}, not for this contract, so there is nothing to compare`;

const KEY_ONLY = "an Atlas document names this limit's key, but none states a value for it on this contract, so there is nothing to compare";

/**
 * The Atlas column: the verdict's mark linked to the document's Onchain tab; a ?
 * linked to the document that names the limit's key where none states a value
 * to compare; else a flag where no document is connected and how the limit was
 * set calls for one (worded for a limit whose controller constant a document
 * names, shown beside its name, when `named`).
 */
export function PauAtlasMark({ verdict, keyDocId, chain, limit, named }: { verdict?: AtlasVerdict; keyDocId?: string | null; chain: string; limit: LiveRateLimit; named?: boolean }) {
  if (!verdict && !keyDocId) return <UnmatchedFlag chain={chain} limit={limit} named={named} />;
  const { mark, text } = verdict?.mark === "elsewhere" ? { mark: "?", text: elsewhereText(verdict.on ?? []) } : verdict ? MARK[verdict.mark] : { mark: "?", text: KEY_ONLY };
  return (
    <Tooltip content={text} delay={MARK_TIP_MS}>
      <AtlasLink to={atlasOnchainHref(verdict?.docId ?? keyDocId!)} className="hover:underline" aria-label={text}>
        {mark}
      </AtlasLink>
    </Tooltip>
  );
}
