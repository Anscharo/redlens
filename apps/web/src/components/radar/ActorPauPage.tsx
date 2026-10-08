import type { ActorProfile } from "../../lib/actorIndex";
import { ActorPageShell } from "./ActorPageShell";
import { ActorPau } from "./ActorPau";

export interface ActorPauPageProps {
  profile: ActorProfile;
}

/** The Prime's PAU deployments as the chain reports them. */
export function ActorPauPage({ profile }: ActorPauPageProps) {
  return (
    <ActorPageShell profile={profile} page="pau">
      <ActorPau prime={profile.entity} instances={profile.instances} />
    </ActorPageShell>
  );
}
