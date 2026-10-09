import type { BeamLimits, TimelineGroup } from "../../lib/pau";
import type { KeyNames } from "./PauChangeLine";
import { PauTimelineEntry } from "./PauTimelineEntry";
import { PauTimelineHeader } from "./PauTimelineHeader";

const dim = { color: "var(--tan-3)" };
const chains = (g: TimelineGroup) => [...new Set(g.entries.map((e) => e.chain))].join(", ");
const span = (g: TimelineGroup) => {
  const [a, b] = [g.entries[0].time.slice(0, 10), g.time.slice(0, 10)];
  return a === b ? b : `${a} to ${b}`;
};
const count = (g: TimelineGroup) => g.entries.reduce((n, e) => n + e.changes.length, 0);

interface Props {
  g: TimelineGroup;
  names: KeyNames;
  beamOf: (chain: string, contract: string) => BeamLimits | undefined;
}

/**
 * One group of the change history. A deployment's group and an operator's day
 * of Configurator changes start collapsed, their summary saying what they
 * hold; an executive's changes are shown.
 */
export function PauTimelineGroup({ g, names, beamOf }: Props) {
  const entries = (
    <ul className="mt-1 space-y-1">
      {g.entries.map((e) => (
        <PauTimelineEntry key={`${e.chain}:${e.tx}`} e={e} names={names} />
      ))}
    </ul>
  );
  if (g.kind !== "deployment" && g.kind !== "operator") {
    return (
      <li className="pau-timeline-group border-t border-[var(--border)] pt-2" data-kind={g.kind} data-spell={g.spell ?? undefined}>
        <PauTimelineHeader g={g} />
        {entries}
      </li>
    );
  }
  const n = count(g);
  const beam = g.kind === "operator" ? beamOf(g.entries[0].chain, g.entries[0].changes[0]?.contract ?? "") : undefined;
  return (
    <li className="pau-timeline-group border-t border-[var(--border)] pt-2" data-kind={g.kind}>
      <details>
        <summary className="cursor-pointer text-xs" style={{ color: "var(--tan-2)" }}>
          {g.kind === "deployment" ? "Deployment" : <PauTimelineHeader g={g} beam={beam} />}
          <span className="mono text-[10px]" style={dim}> · {chains(g)} · {n} change{n === 1 ? "" : "s"} in {g.entries.length} tx · {span(g)}</span>
        </summary>
        {entries}
      </details>
    </li>
  );
}
