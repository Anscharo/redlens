import { PAU_KIND_LABEL, type AtlasKeyRef, type StoredPauSnapshot } from "../../lib/pau";
import { PauBeam } from "./ActorPauBeam";
import { PauFacets } from "./ActorPauFacets";
import { PauHolders } from "./ActorPauHolders";
import { PauRateLimits } from "./ActorPauRateLimits";
import { PauContracts } from "./PauContracts";
import { PauParams } from "./ActorPauParams";
import { PauWiring } from "./PauWiring";
import { anchorProps } from "./PauSectionHeading";
import { CopyLink } from "../CopyLink";
import type { Anchor } from "@/lib/pauAnchors";
import type { AtlasVerdict } from "@/lib/pauAtlasMatch";

const chainLabel = (chain: string) => chain.charAt(0).toUpperCase() + chain.slice(1);
const dim = { color: "var(--tan-3)" };

interface Props {
  snap: StoredPauSnapshot;
  keyIndex: Map<string, AtlasKeyRef[]>;
  /** Each key's Atlas verdict (pauAtlasMatch.ts). */
  verdicts: Map<string, AtlasVerdict>;
  defaultOpen: boolean;
  /** Its fragment, `#<chain>` (pauAnchors.ts); its sections are named under it. */
  anchor: Anchor;
}

/** One deployment: a collapsible card with its contracts, facets, holders, rate limits and parameters. */
export function PauDeployment({ snap, keyIndex, verdicts, defaultOpen, anchor }: Props) {
  const limits = snap.contracts.flatMap((c) => (c.rateLimits ?? []).map((r) => ({ ...r, contract: c.address })));
  const loading = snap.contracts.some((c) => !c.historyComplete);
  const firstBeam = snap.contracts.find((c) => c.beam)?.address;
  return (
    <div className="relative">
      <CopyLink id={anchor.id} label={`${chainLabel(snap.chain)} ${PAU_KIND_LABEL[snap.kind]}`} top={10} />
      <details {...anchorProps(anchor)} open={defaultOpen} className="pau-deployment mb-3 border-t border-[var(--border)] pt-2" data-deployment={snap.deployment} data-kind={snap.kind}>
        <summary className="cursor-pointer mono text-[12px] flex flex-wrap items-baseline gap-2" style={{ color: "var(--tan)" }}>
          <h3 className="inline">{chainLabel(snap.chain)}</h3>
          <span className="text-[11px] px-1.5 rounded" style={{ border: "1px solid var(--border)", color: "var(--tan-2)" }}>{PAU_KIND_LABEL[snap.kind]}</span>
          <PauWiring snap={snap} />
          <span className="text-[11px]" style={dim}>{limits.length} rate limits</span>
          {loading && <span className="text-[11px]" style={{ color: "var(--accent)" }}>history still being read</span>}
        </summary>
        <PauContracts snap={snap} />
        <PauFacets snap={snap} anchor={anchor} />
        <PauHolders snap={snap} anchor={anchor} />
        <PauRateLimits chain={snap.chain} limits={limits} keyIndex={keyIndex} verdicts={verdicts} anchor={anchor} />
        {snap.contracts.map((c) => c.beam && <PauBeam key={c.address} beam={c.beam} chain={snap.chain} keyIndex={keyIndex} anchor={c.address === firstBeam ? anchor : undefined} />)}
        <PauParams snap={snap} anchor={anchor} />
        <p className="mono text-[11px] mt-2" style={dim}>read {snap.fetchedAt.slice(0, 16).replace("T", " ")} UTC</p>
      </details>
    </div>
  );
}
