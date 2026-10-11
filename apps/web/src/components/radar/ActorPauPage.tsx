import type { ActorProfile } from "../../lib/actorIndex";
import { atlasHref } from "@/lib/routes";
import { AtlasLink } from "../AtlasLink";
import { ActorPageShell } from "./ActorPageShell";
import { ActorPau } from "./ActorPau";

/** The atlas document defining the Diamond PAU (A.2.2.10.1.1.1.2), linked at the top of every PAUs page. */
const DIAMOND_PAU_DOC = "d5cfb5ed-20a9-42a0-9838-ef21e1115648";

export interface ActorPauPageProps {
  profile: ActorProfile;
}

/** The Prime's PAU deployments as the chain reports them. */
export function ActorPauPage({ profile }: ActorPauPageProps) {
  return (
    <ActorPageShell profile={profile} page="pau">
      <p className="text-[12px] -mt-4 mb-6" style={{ color: "var(--tan-3)" }}>
        Defined in the Atlas: <AtlasLink to={atlasHref(DIAMOND_PAU_DOC)} className="text-accent hover:underline">Diamond PAU</AtlasLink>
      </p>
      <ActorPau prime={profile.entity} instances={profile.instances} />
    </ActorPageShell>
  );
}
