import { useMemo } from "react";
import type { AtlasKeyRef, StoredPauSnapshot, TimelineGroup } from "../../lib/pau";
import { groupAnchors, PAU_ANCHOR } from "@/lib/pauAnchors";
import { PauPartHeading } from "./PauSectionHeading";
import { PauTimelineGroup } from "./PauTimelineGroup";
import { PauTimelineKey } from "./PauTimelineKey";

const dim = { color: "var(--tan-3)" };
const changeCount = (groups: TimelineGroup[]) => groups.reduce((n, g) => n + g.entries.reduce((m, e) => m + e.changes.length, 0), 0);

/** What the history proves and how it is grouped; until any change is attributed, one line saying so instead. */
function Intro({ groups }: { groups: TimelineGroup[] }) {
  const kinds = new Set(groups.map((g) => g.kind));
  if (kinds.size === 1 && kinds.has("unknown")) {
    return (
      <p className="text-[12px] mb-2" style={dim} data-unattributed>
        None of this Prime&apos;s {changeCount(groups)} changes is attributed yet. The atlas worker credits each to its Executive Vote, operator or
        deployment as it reads the governance contracts; until then they are listed below by chain.
      </p>
    );
  }
  return (
    <>
      <p className="text-[12px] mb-2" style={dim}>
        Each change is credited to a spell only when the chain proves it: DSPause ran the spell in the transaction, the prime&apos;s StarGuard
        executed a star spell that spell plotted, or a bridge message id ties an L2 action set to that transaction.
      </p>
      <PauTimelineKey kinds={kinds} />
    </>
  );
}

interface Props {
  /** The prime's change history, grouped (pauTimeline.ts); empty until GET /api/pau/history loads. */
  groups: TimelineGroup[];
  snaps: StoredPauSnapshot[];
  keyIndex: Map<string, AtlasKeyRef[]>;
}

/**
 * Every configuration change the stored history holds for this prime, newest
 * first, grouped by the executive whose spell made it (GET /api/pau/history).
 * Changes no spell made say what made them instead.
 */
export function ActorPauTimeline({ groups, snaps, keyIndex }: Props) {
  const anchors = useMemo(() => groupAnchors(groups), [groups]);
  const derived = useMemo(() => new Map(snaps.flatMap((s) => s.contracts.flatMap((c) => c.rateLimits ?? [])).flatMap((r) => (r.derived ? [[r.key.toLowerCase(), r.derived] as const] : []))), [snaps]);
  const beamOf = (chain: string, contract: string) =>
    snaps.filter((s) => s.chain === chain).flatMap((s) => s.contracts).find((c) => c.address === contract && c.beam)?.beam;
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby={PAU_ANCHOR.changeHistory} className="mt-6">
      <PauPartHeading anchor={{ id: PAU_ANCHOR.changeHistory, aliases: ["pau-history"] }}>Change history</PauPartHeading>
      <Intro groups={groups} />
      <ol className="space-y-3">
        {groups.map((g) => (
          <PauTimelineGroup key={g.key} g={g} anchor={anchors.get(g.key)!} names={{ keyIndex, derived }} beamOf={beamOf} />
        ))}
      </ol>
    </section>
  );
}
