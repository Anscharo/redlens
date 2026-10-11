import type { AtlasKeyRef, PauParam, StoredPauSnapshot } from "../../lib/pau";
import { matchId } from "@/lib/pauAtlasMatch";
import { PauBeam } from "./ActorPauBeam";
import { PauHolders } from "./ActorPauHolders";
import { PauRateLimits } from "./ActorPauRateLimits";
import { AtlasDocLink, PauContracts } from "./PauContracts";
import { PauWiring } from "./PauWiring";
import { PauSectionHeading, anchorProps } from "./PauSectionHeading";
import { CopyLink } from "../CopyLink";
import type { Anchor } from "@/lib/pauAnchors";

const chainLabel = (chain: string) => chain.charAt(0).toUpperCase() + chain.slice(1);
const dim = { color: "var(--tan-3)" };

interface Props {
  snap: StoredPauSnapshot;
  keyIndex: Map<string, AtlasKeyRef[]>;
  matched: Set<string>;
  defaultOpen: boolean;
  /** Its fragment, `#<chain>` (pauAnchors.ts); its sections are named under it. */
  anchor: Anchor;
}

/** One deployment: a collapsible card with its contracts, holders, rate limits and parameters. */
export function PauDeployment({ snap, keyIndex, matched, defaultOpen, anchor }: Props) {
  const limits = snap.contracts.flatMap((c) => c.rateLimits ?? []);
  const atlas = new Set(snap.contracts.flatMap((c) => (c.rateLimits ?? []).filter((r) => matched.has(matchId(c.address, r.key))).map((r) => r.key)));
  const params = snap.contracts.flatMap((c) => (c.params ?? []).map((p) => ({ ...p, contract: c.address })));
  const loading = snap.contracts.some((c) => !c.historyComplete);
  const controller = snap.contracts.find((c) => c.role === "controller");
  const firstBeam = snap.contracts.find((c) => c.beam)?.address;
  return (
    <div className="relative">
      <CopyLink id={anchor.id} label={`${chainLabel(snap.chain)} ${snap.kind}`} top={10} />
      <details {...anchorProps(anchor)} open={defaultOpen} className="pau-deployment mb-3 border-t border-[var(--border)] pt-2" data-deployment={snap.deployment} data-kind={snap.kind}>
        <summary className="cursor-pointer mono text-[12px] flex flex-wrap items-baseline gap-2" style={{ color: "var(--tan)" }}>
          <h3 className="inline">{chainLabel(snap.chain)}</h3>
          <AtlasDocLink docs={controller?.atlasDocs} title="the atlas document stating this controller" className="text-[11px] px-1.5 rounded" style={{ border: "1px solid var(--border)", color: "var(--tan-2)" }}>
            {snap.kind}
          </AtlasDocLink>
          <PauWiring snap={snap} />
          <span className="text-[11px]" style={dim}>{limits.length} rate limits</span>
          {loading && <span className="text-[11px]" style={{ color: "var(--accent)" }}>history still being read</span>}
        </summary>
        <PauContracts snap={snap} />
        <PauHolders snap={snap} anchor={anchor} />
        <PauRateLimits chain={snap.chain} limits={limits} keyIndex={keyIndex} atlasMatched={atlas} anchor={anchor} />
        {snap.contracts.map((c) => c.beam && <PauBeam key={c.address} beam={c.beam} chain={snap.chain} keyIndex={keyIndex} anchor={c.address === firstBeam ? anchor : undefined} />)}
        <PauParams params={params} anchor={anchor} />
        <p className="mono text-[11px] mt-2" style={dim}>read {snap.fetchedAt.slice(0, 16).replace("T", " ")} UTC</p>
      </details>
    </div>
  );
}

const paramValue = (p: PauParam) =>
  Object.entries(p.args)
    .filter(([, v]) => String(v) !== p.subject)
    .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");

/** The latest value of each per-pool or per-domain parameter (max slippage, recipients, tick bounds). */
function PauParams({ params, anchor }: { params: (PauParam & { contract: string })[]; anchor: Anchor }) {
  if (params.length === 0) return null;
  return (
    <div className="mt-3">
      <PauSectionHeading deployment={anchor} section="parameters">Parameters</PauSectionHeading>
      <ul className="space-y-0.5">
        {params.map((p) => (
          <li key={`${p.contract}:${p.event}:${p.subject}`} className="mono text-[11px] break-words" style={{ color: "var(--tan-2)" }}>
            {p.event} <span title={p.subject}>{p.subject.length > 20 ? `${p.subject.slice(0, 10)}…` : p.subject}</span>{" "}
            <span style={dim}>{paramValue(p)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
