import { Link } from "../Link";
import { actorHref } from "@/lib/routes";
import type { ActorProfile } from "../../lib/actorIndex";
import { ActorHistory } from "./ActorHistory";

interface Props {
  profile: ActorProfile;
}

/** The full change history for one actor. The dashboard shows only the most
 *  recent HISTORY_PREVIEW entries and links here for the rest, so a long
 *  history cannot run the actor page down the screen. */
export function ActorHistoryPage({ profile }: Props) {
  const { entity } = profile;
  return (
    <div className="flex-1 px-6 py-6 min-w-0">
      <div className="max-w-6xl mx-auto">
        <p className="mono text-xs mb-1" style={{ color: "var(--tan-3)" }}>
          <Link to={actorHref(entity.slug)} className="hover:text-accent hover:underline">
            radar · {entity.name}
          </Link>
        </p>
        <h1 className="text-xl font-semibold mb-6" style={{ color: "var(--tan)" }}>
          History of Doc Changes affecting {entity.name}
        </h1>
        <ActorHistory profile={profile} />
      </div>
    </div>
  );
}
