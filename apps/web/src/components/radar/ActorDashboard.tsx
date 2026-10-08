import { Link } from "../Link";
import { useArrivalTarget } from "../../hooks/useArrivalTarget";
import { AtlasLink } from "../AtlasLink";
import type { ActorProfile } from "../../lib/actorIndex";
import { ENTITY_TYPE_LABEL, ENTITY_TYPE_COLOR } from "../../lib/entityGraph";
import { atlasHref, actorHref } from "@/lib/routes";
import { ActorChain } from "./ActorChain";
import { ActorContact } from "./ActorContact";
import { ActorResponsibilities } from "./ActorResponsibilities";
import { ActorRewards } from "./ActorRewards";
import { ActorHistory } from "./ActorHistory";
import { ActorSettlementTeaser } from "./ActorSettlementTeaser";
import { ActorConnections } from "./ActorConnections";
import { Section } from "./RadarSection";
import { useSubpageAnchorForward } from "./useSubpageAnchorForward";
import { CompositePartySection } from "./CompositePartySection";
import { RADAR_SECTION } from "@/lib/radarAnchors";
import { hasActorPages } from "@/lib/radarPages";

interface Props {
  profile: ActorProfile;
}

export function ActorDashboard({ profile }: Props) {
  const split = hasActorPages(profile.entity);
  useArrivalTarget(profile.entity.id);
  useSubpageAnchorForward(profile.entity.slug, profile.primitives, split);

  const {
    entity,
    definingDoc,
    chain,
    adRows,
    rewardsAgent,
    comprisesMembers,
    partOfComposite,
  } = profile;
  const color = ENTITY_TYPE_COLOR[entity.et] ?? "var(--entity-fallback)";
  const agentLabel = entity.st === "prime" ? "Prime Agent" : "Executor Agent";
  const typeLabel = entity.et === "agent" ? agentLabel : (ENTITY_TYPE_LABEL[entity.et] ?? entity.et);

  return (
    <div className="flex-1 px-6 py-6 min-w-0">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-8">
        <div className="lg:col-span-2 min-w-0 flow-root">
          {/* Floated first → top-right of the agent header; null if no MSC workbook. */}
          <ActorSettlementTeaser slug={entity.slug} />
          {/* Header */}
          <div className="mb-6">
            <p className="mono text-xs mb-1" style={{ color: "var(--tan-3)" }}>
              radar
            </p>
            <h1 className="text-xl font-semibold" style={{ color: "var(--tan)" }}>
              {entity.name}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span
                className="mono text-[11px] px-1.5 py-0.5 rounded"
                style={{ border: `1px solid ${color}`, color }}
              >
                {typeLabel}
              </span>
              {definingDoc && (
                <AtlasLink
                  to={atlasHref(definingDoc.id)}
                  className="mono text-[10px] text-accent hover:underline"
                >
                  {definingDoc.doc_no} <span className="enlargen">→</span>
                </AtlasLink>
              )}
              {partOfComposite?.slug && (
                <Link
                  to={actorHref(partOfComposite.slug)}
                  className="mono text-[10px] text-tan-3 hover:text-accent hover:underline"
                >
                  part of {partOfComposite.name} <span className="enlargen">→</span>
                </Link>
              )}
            </div>
          </div>

          {/* Chain — always shown */}
          <div className="mb-6">
            <ActorChain chain={chain} currentSlug={entity.slug} />
          </div>
        </div>

        <div className="min-w-0">
          {/* Contact — governance channels + emergency response (Prime Agents) */}
          <ActorContact contact={profile.contact} />

          {entity.et === "composite_party" && <CompositePartySection members={comprisesMembers} />}
          {adRows.length > 0 && (
            <Section title="Responsibilities" id={RADAR_SECTION.responsibilities}>
              <ActorResponsibilities rows={adRows} />
            </Section>
          )}
          {/* Only Primes have primitives, and a Prime's instances, history and
              PAUs are subpages (radarPages.ts). */}
          {!split && <ActorConnections profile={profile} />}
        </div>

        <aside className="min-w-0">
          {split ? (
            <ActorConnections profile={profile} />
          ) : (
            <Section
              title={"History of Doc Changes affecting " + profile.entity.name}
              id={RADAR_SECTION.history}
            >
              <ActorHistory profile={profile} />
            </Section>
          )}
        </aside>

        {rewardsAgent && (
          <div className="lg:col-span-2 min-w-0">
            <Section title="Rewards" id={RADAR_SECTION.rewards}>
              <ActorRewards agent={rewardsAgent} />
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
