import { useArrivalTarget } from "../../hooks/useArrivalTarget";
import type { ActorProfile } from "../../lib/actorIndex";
import { ActorPageShell } from "./ActorPageShell";
import { ActorInstances } from "./ActorInstances";
import { PrimitiveLifecycle } from "./PrimitiveLifecycle";

export interface ActorInstancesPageProps {
  profile: ActorProfile;
}

/** The actor's primitives with their invocations and instances, grouped by category.
 *  Radar search and the primitive matrix link here by instance anchor. */
export function ActorInstancesPage({ profile }: ActorInstancesPageProps) {
  useArrivalTarget(`${profile.entity.id}/primitives`);
  return (
    <ActorPageShell profile={profile} page="primitives">
      <PrimitiveLifecycle />
      {profile.primitives.length > 0 ? (
        <ActorInstances primitives={profile.primitives} prime={profile.entity} />
      ) : (
        <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>no primitives</p>
      )}
    </ActorPageShell>
  );
}
