import type { AtlasKeyRef, BeamLimits, TimelineGroup } from "../../lib/pau";
import { PauTimelineEntry } from "./PauTimelineEntry";
import { PauTimelineHeader } from "./PauTimelineHeader";

const chains = (g: TimelineGroup) => [...new Set(g.entries.map((e) => e.chain))].join(", ");

/** One group of the change history; a deployment's group starts collapsed. */
export function PauTimelineGroup({ g, keyIndex, beamOf }: { g: TimelineGroup; keyIndex: Map<string, AtlasKeyRef[]>; beamOf: (chain: string, contract: string) => BeamLimits | undefined }) {
  const entries = (
    <ul className="mt-1 space-y-1">
      {g.entries.map((e) => (
        <PauTimelineEntry key={`${e.chain}:${e.tx}`} e={e} keyIndex={keyIndex} />
      ))}
    </ul>
  );
  if (g.kind === "deployment") {
    return (
      <li className="pau-timeline-group border-t border-[var(--border)] pt-2" data-kind={g.kind}>
        <details>
          <summary className="cursor-pointer text-xs" style={{ color: "var(--tan-2)" }}>
            Deployment <span className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>· {chains(g)} · {g.entries.length} tx · {g.time.slice(0, 10)}</span>
          </summary>
          {entries}
        </details>
      </li>
    );
  }
  return (
    <li className="pau-timeline-group border-t border-[var(--border)] pt-2" data-kind={g.kind} data-spell={g.spell ?? undefined}>
      <PauTimelineHeader g={g} beam={g.kind === "operator" ? beamOf(g.entries[0].chain, g.entries[0].changes[0]?.contract ?? "") : undefined} />
      {entries}
    </li>
  );
}
