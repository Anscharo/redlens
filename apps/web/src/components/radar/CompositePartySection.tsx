import { Link } from "../Link";
import { AtlasLink } from "../AtlasLink";
import type { ActorProfile } from "../../lib/actorIndex";
import { atlasHref, actorHref } from "@/lib/routes";
import { Section } from "./RadarSection";

export function CompositePartySection({ members }: { members: ActorProfile["comprisesMembers"] }) {
  return (
    <Section title="Composite Party">
      <p className="text-sm mb-3" style={{ color: "var(--tan-2)" }}>
        A composite party is the named legal counterparty in a Sky{" "}
        <AtlasLink to={atlasHref("104c3543-ce94-4a2f-9968-57f1ee858085")} className="text-accent hover:underline">
          Ecosystem Accord
        </AtlasLink>
        {" "}— an agreement between Sky Ecosystem actors that is enforceable by Sky Governance. It may comprise the Prime Agent and associated legal entities (foundation, development company) acting together as a single party to the accord.
      </p>
      {members.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {members.map((m) =>
            m.slug ? (
              <Link key={m.slug} to={actorHref(m.slug)}
                className="text-xs px-2 py-0.5 rounded border border-[var(--border)] text-accent hover:border-[var(--accent)] transition-colors">
                {m.name}
              </Link>
            ) : (
              <span key={m.name} className="text-xs px-2 py-0.5 rounded border border-[var(--border)] text-tan-2">
                {m.name}
              </span>
            )
          )}
        </div>
      )}
    </Section>
  );
}
