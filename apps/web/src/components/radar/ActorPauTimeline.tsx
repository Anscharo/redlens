import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadPauHistory, timelineFor, type AtlasKeyRef, type StoredPauSnapshot } from "../../lib/pau";
import { PauTimelineGroup } from "./PauTimelineGroup";

interface Props {
  /** Prime entity UUID. */
  prime: string;
  snaps: StoredPauSnapshot[];
  keyIndex: Map<string, AtlasKeyRef[]>;
}

/**
 * Every configuration change the stored history holds for this prime, newest
 * first, grouped by the executive whose spell made it (GET /api/pau/history).
 * Changes no spell made say what made them instead.
 */
export function ActorPauTimeline({ prime, snaps, keyIndex }: Props) {
  const res = useLoaded(loadPauHistory, { soft: true });
  const groups = useMemo(() => (res ? timelineFor(res, prime) : []), [res, prime]);
  const beamOf = (chain: string, contract: string) =>
    snaps.filter((s) => s.chain === chain).flatMap((s) => s.contracts).find((c) => c.address === contract && c.beam)?.beam;
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="pau-change-history" className="mt-6" id="pau-history" style={{ scrollMarginTop: "64px" }}>
      <h3 id="pau-change-history" className="mono text-[11px] uppercase tracking-wider mb-1" style={{ color: "var(--tan-2)" }}>Change history</h3>
      <p className="text-[11px] mb-2" style={{ color: "var(--tan-3)" }}>
        Each change is credited to a spell only when the chain proves it: DSPause ran the spell in the transaction, the prime&apos;s StarGuard
        executed a star spell that spell plotted, or a bridge message id ties an L2 action set to that transaction.
      </p>
      <ol className="space-y-3">
        {groups.map((g) => (
          <PauTimelineGroup key={g.key} g={g} keyIndex={keyIndex} beamOf={beamOf} />
        ))}
      </ol>
    </section>
  );
}
