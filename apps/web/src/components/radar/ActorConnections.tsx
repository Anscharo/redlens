import type { ActorProfile } from "../../lib/actorIndex";
import { RADAR_SECTION } from "@/lib/radarAnchors";
import { Section } from "./RadarSection";
import { RelationRow } from "./RelationRow";
import { RecRow } from "./RecRow";

export interface ActorConnectionsProps {
  profile: Pick<ActorProfile, "relations" | "recommendations">;
}

/** The actor's Relationships and Notable sections; each is left out when empty. */
export function ActorConnections({ profile: { relations, recommendations } }: ActorConnectionsProps) {
  return (
    <>
      {relations.length > 0 && (
        <Section title="Relationships" id={RADAR_SECTION.relationships}>
          {relations.map((r, i) => (
            <RelationRow key={i} r={r} />
          ))}
        </Section>
      )}
      {recommendations.length > 0 && (
        <Section title="Notable" id={RADAR_SECTION.notable}>
          {recommendations.map((rec, i) => (
            <RecRow key={i} rec={rec} />
          ))}
        </Section>
      )}
    </>
  );
}
