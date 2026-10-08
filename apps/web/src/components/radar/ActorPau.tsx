import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { instanceKeyIndex, loadPau, snapshotsForPrime, type KeyedInstance } from "../../lib/pau";
import { RADAR_SECTION } from "@/lib/radarAnchors";
import { Section } from "./RadarSection";
import { PauDeployment } from "./ActorPauDeployment";

interface Props {
  /** Graph entity UUID of the prime agent; the PAU registry keys deployments by it. */
  primeId: string;
  /** The prime's instances; their rate-limit ID parameters name the on-chain keys. */
  instances: KeyedInstance[];
}

/**
 * The prime's PAU deployments as the chain reports them (GET /api/pau), as a
 * full-width row of the actor grid. Renders nothing until the worker has stored
 * a snapshot for this entity, so every actor the PAU registry does not list (any
 * non-prime) and a prime with no snapshot yet simply have no section.
 */
export function ActorPau({ primeId, instances }: Props) {
  const res = useLoaded(loadPau, { soft: true });
  const keyIndex = useMemo(() => instanceKeyIndex(instances), [instances]);
  const snaps = useMemo(() => (res ? snapshotsForPrime(res, primeId) : []), [res, primeId]);
  if (snaps.length === 0) return null;

  return (
    <div className="lg:col-span-2 min-w-0">
      <Section title="PAU on-chain" id={RADAR_SECTION.pau}>
        <p className="text-[11px] mb-3" style={{ color: "var(--tan-3)" }}>
          Read from the chain for each contract in the PAU registry. Role holders come from the contracts&apos; grant history,
          each confirmed live; a rate limit is named by the instance whose parameters state its ID.
        </p>
        {snaps.map((s, i) => (
          <PauDeployment key={s.deployment} snap={s} keyIndex={keyIndex} defaultOpen={i === 0} />
        ))}
      </Section>
    </div>
  );
}
