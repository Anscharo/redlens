import type { ReactNode } from "react";
import type { BeamLimits, TimelineGroup } from "../../lib/pau";
import type { KeyNames } from "./PauChangeLine";
import { PauTimelineEntry } from "./PauTimelineEntry";
import { PauTimelineHeader } from "./PauTimelineHeader";
import { anchorProps } from "./PauSectionHeading";
import { CopyLink } from "../CopyLink";
import type { Anchor } from "@/lib/pauAnchors";

const dim = { color: "var(--tan-3)" };
const chains = (g: TimelineGroup) => [...new Set(g.entries.map((e) => e.chain))].join(", ");
const span = (g: TimelineGroup) => {
  const [a, b] = [g.entries[0].time.slice(0, 10), g.time.slice(0, 10)];
  return a === b ? b : `${a} to ${b}`;
};
const count = (g: TimelineGroup) => g.entries.reduce((n, e) => n + e.changes.length, 0);

interface Props {
  g: TimelineGroup;
  /** Its fragment (pauAnchors.ts): on the group when shown, on its `<details>` when collapsed, so arriving opens it. */
  anchor: Anchor;
  names: KeyNames;
  beamOf: (chain: string, contract: string) => BeamLimits | undefined;
}

/** What a group's copy link names it. */
const label = (g: TimelineGroup) =>
  g.kind === "executive" ? (g.executive?.date ? `Executive Vote ${g.executive.date}` : `spell ${g.spell}`) : `${LABEL[g.kind] ?? g.kind} on ${chains(g)}, ${span(g)}`;

const COLLAPSED = new Set<TimelineGroup["kind"]>(["deployment", "operator", "unknown"]);
const LABEL: Partial<Record<TimelineGroup["kind"], string>> = { deployment: "Deployment", unknown: "Not yet attributed" };

/**
 * One group of the change history. A deployment's group, an operator's day of
 * Configurator changes and a chain's changes not attributed yet start
 * collapsed, their summary saying what they hold; an executive's changes are
 * shown.
 */
export function PauTimelineGroup({ g, anchor, names, beamOf }: Props) {
  const entries = (
    <ul className="mt-1 space-y-1">
      {g.entries.map((e) => (
        <PauTimelineEntry key={`${e.chain}:${e.tx}`} e={e} names={names} />
      ))}
    </ul>
  );
  if (!COLLAPSED.has(g.kind)) {
    return (
      <li {...anchorProps(anchor)} className="pau-timeline-group relative border-t border-[var(--border)] pt-2" data-kind={g.kind} data-spell={g.spell ?? undefined}>
        <CopyLink id={anchor.id} label={label(g)} top={10} />
        <PauTimelineHeader g={g} />
        {entries}
      </li>
    );
  }
  const beam = g.kind === "operator" ? beamOf(g.entries[0].chain, g.entries[0].changes[0]?.contract ?? "") : undefined;
  return <CollapsedGroup g={g} anchor={anchor} beam={beam}>{entries}</CollapsedGroup>;
}

/** A group that starts collapsed, its summary saying what it holds; the fragment is on its `<details>`, so arriving opens it. */
function CollapsedGroup({ g, anchor, beam, children }: { g: TimelineGroup; anchor: Anchor; beam?: BeamLimits; children: ReactNode }) {
  const n = count(g);
  return (
    <li className="pau-timeline-group relative border-t border-[var(--border)] pt-2" data-kind={g.kind}>
      <CopyLink id={anchor.id} label={label(g)} top={10} />
      <details {...anchorProps(anchor)}>
        <summary className="cursor-pointer text-[13px]" style={{ color: "var(--tan-2)" }}>
          <h3 className="inline">{LABEL[g.kind] ?? <PauTimelineHeader g={g} beam={beam} />}</h3>
          <span className="mono text-[11px]" style={dim}> · {chains(g)} · {n} change{n === 1 ? "" : "s"} in {g.entries.length} tx · {span(g)}</span>
        </summary>
        {children}
      </details>
    </li>
  );
}
