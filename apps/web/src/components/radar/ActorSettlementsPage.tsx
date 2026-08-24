import { Link } from "../Link";
import { actorHref } from "@/lib/routes";
import { FORUM_CYCLES } from "@/lib/forumKinds";
import type { ActorProfile } from "../../lib/actorIndex";
import { ActorSettlements } from "./ActorSettlements";

const FORUM_TAG_URL = FORUM_CYCLES[0].forumTagUrl;

interface Props {
  profile: ActorProfile;
}

export function ActorSettlementsPage({ profile }: Props) {
  const { entity } = profile;
  return (
    <div className="flex-1 px-6 py-6 min-w-0">
      <div className="max-w-6xl mx-auto">
        <p className="mono text-xs mb-1" style={{ color: "var(--tan-3)" }}>
          <Link to={actorHref(entity.slug)} className="hover:text-accent hover:underline">
            radar · {entity.name}
          </Link>
        </p>
        <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--tan)" }}>
          Monthly settlement
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--tan-3)" }}>
          <a
            href={FORUM_TAG_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Sky Forum reports
          </a>
        </p>
        <ActorSettlements slug={entity.slug} name={entity.name} />
      </div>
    </div>
  );
}
