import type { ActorProfile } from "../../lib/actorIndex";
import { ActorPageShell } from "./ActorPageShell";
import { ActorSettlements } from "./ActorSettlements";

export interface ActorSettlementsPageProps {
  profile: ActorProfile;
}

export function ActorSettlementsPage({ profile }: ActorSettlementsPageProps) {
  return (
    <ActorPageShell profile={profile} page="settlements">
      <ActorSettlements slug={profile.entity.slug} name={profile.entity.name} />
    </ActorPageShell>
  );
}
