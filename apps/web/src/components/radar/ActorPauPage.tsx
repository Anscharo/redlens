import type { ActorProfile } from "../../lib/actorIndex";
import { atlasHref } from "@/lib/routes";
import { AtlasLink } from "../AtlasLink";
import { ActorPageShell } from "./ActorPageShell";
import { ActorPau } from "./ActorPau";
import { PauAuditLink } from "./PauAuditLink";

/** The atlas document defining the Diamond PAU (A.2.2.10.1.1.1.2), linked at the top of every PAUs page. */
const DIAMOND_PAU_DOC = "d5cfb5ed-20a9-42a0-9838-ef21e1115648";

export interface ActorPauPageProps {
  profile: ActorProfile;
}

/** The atlas document defining the Allocation System Primitive (A.2.2.10.1), the primitive a Prime's Liquidity Layer Architecture belongs to. */
const ALLOCATION_SYSTEM_DOC = "9db14ab7-bb4b-4751-8084-843bd4359f2a";

/** The Prime's Liquidity Layer Architecture as the chain reports it: each chain's controller deployments. */
export function ActorPauPage({ profile }: ActorPauPageProps) {
  return (
    <ActorPageShell profile={profile} page="pau">
      <p className="text-[12px] -mt-4 mb-3 max-w-[60rem]" style={{ color: "var(--tan-3)" }}>
        Liquidity Layer Architecture is part of {profile.entity.name}&apos;s{" "}
        <AtlasLink to={atlasHref(ALLOCATION_SYSTEM_DOC)} className="text-accent hover:underline">Allocation System Primitive</AtlasLink>. It lists the contracts, rate limits and on-chain
        parameters of its controllers on each chain. On a chain, a Prime Agent runs a monolithic ALM Controller, a Diamond PAU (a controller that dispatches to facets), or both.
      </p>
      <p className="text-[12px] mb-6 flex flex-wrap gap-x-4 gap-y-1" style={{ color: "var(--tan-3)" }}>
        <span>
          Defined in the Atlas: <AtlasLink to={atlasHref(DIAMOND_PAU_DOC)} className="text-accent hover:underline">Diamond PAU</AtlasLink>
        </span>
        <PauAuditLink primeId={profile.entity.id} primeName={profile.entity.name} />
      </p>
      <ActorPau prime={profile.entity} instances={profile.instances} />
    </ActorPageShell>
  );
}
