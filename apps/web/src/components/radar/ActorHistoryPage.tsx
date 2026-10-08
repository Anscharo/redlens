import type { ActorProfile } from "../../lib/actorIndex";
import { ActorPageShell } from "./ActorPageShell";
import { ActorHistory } from "./ActorHistory";

export interface ActorHistoryPageProps {
  profile: ActorProfile;
}

/** Every Atlas commit that changed a document about this actor. */
export function ActorHistoryPage({ profile }: ActorHistoryPageProps) {
  return (
    <ActorPageShell profile={profile} page="history">
      <ActorHistory profile={profile} />
    </ActorPageShell>
  );
}
