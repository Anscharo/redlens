import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { OmniTopic } from "../../lib/actorIndex";

/** An agent's Omni Documents in two lines: the count, then the topics that
 *  are this agent's own. Every agent artifact carries the same primitives,
 *  so what differs between them is here — Spark runs ten of these (Arkis
 *  Infrastructure, Offchain Collateralized Lending, Risk Curation
 *  Framework, …) where Pattern runs one. The two every agent has are left
 *  out of the line, because the page already shows them: Governance
 *  Information is the Contact card, Ecosystem Accords are a relationship. */
export function ActorOmni({ topics }: { topics: OmniTopic[] }) {
  if (topics.length === 0) return null;
  const own = topics.filter((t) => !t.universal);
  return (
    <section className="mb-6" aria-labelledby="omni-heading">
      <h2
        id="omni-heading"
        className="mono text-[10px] uppercase tracking-wider mb-1"
        style={{ color: "var(--tan-3)" }}
      >
        Omni documents · {topics.length}
      </h2>
      <p className="text-sm msc-omni-line" style={{ color: "var(--tan-2)" }}>
        {own.length === 0 ? (
          <span style={{ color: "var(--tan-3)" }}>
            The standard set only — no governance topics of its own.
          </span>
        ) : (
          own.map((t, i) => (
            <span key={t.id}>
              {i > 0 && <span style={{ color: "var(--tan-3)" }}> · </span>}
              <AtlasLink to={atlasHref(t.id)} className="hover:text-accent hover:underline">
                {t.title}
              </AtlasLink>
            </span>
          ))
        )}
      </p>
    </section>
  );
}
