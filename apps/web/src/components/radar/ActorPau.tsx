import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { addressKeyIndex, instanceKeyIndex, loadPau, primeKeyedInstance, snapshotsForPrime, withAddressKeys, type KeyedInstance } from "../../lib/pau";
import type { GraphEntity } from "@/types";
import { PauDeployment } from "./ActorPauDeployment";
import { ActorPauTimeline } from "./ActorPauTimeline";

interface Props {
  /** The prime agent: the PAU registry keys deployments by its id, and its params name its controller-wide keys. */
  prime: Pick<GraphEntity, "id" | "m">;
  /** The prime's instances; their rate-limit ID parameters name the other on-chain keys. */
  instances: KeyedInstance[];
}

/**
 * The prime's PAU deployments as the chain reports them (GET /api/pau), the
 * body of its PAUs subpage. Until the worker has stored a snapshot for this
 * entity it says so instead.
 */
export function ActorPau({ prime, instances }: Props) {
  const res = useLoaded(loadPau, { soft: true });
  const snaps = useMemo(() => (res ? snapshotsForPrime(res, prime.id) : []), [res, prime.id]);
  const keyIndex = useMemo(
    () => withAddressKeys(instanceKeyIndex([primeKeyedInstance(prime.m), ...instances]), addressKeyIndex(instances, snaps)),
    [prime.m, instances, snaps],
  );
  if (snaps.length === 0) {
    return (
      <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        {res ? "no PAU contracts have been read for this Prime yet" : "loading PAU snapshots…"}
      </p>
    );
  }

  return (
    <section aria-label="PAU on-chain">
      <p className="text-[11px] mb-3" style={{ color: "var(--tan-3)" }}>
        Read from the chain for each contract in the PAU registry. Role holders come from the contracts&apos; grant history,
        each confirmed live; a rate limit is named by the prime or instance whose parameters state its ID.
      </p>
      {snaps.map((s, i) => (
        <PauDeployment key={s.deployment} snap={s} keyIndex={keyIndex} defaultOpen={i === 0} />
      ))}
      <ActorPauTimeline prime={prime.id} snaps={snaps} keyIndex={keyIndex} />
    </section>
  );
}
