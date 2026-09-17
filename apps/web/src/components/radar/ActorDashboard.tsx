import { useEffect } from "react";
import { Link } from "../Link";
import { AtlasLink } from "../AtlasLink";
import type { ActorProfile, ActorRelation, Recommendation } from "../../lib/actorIndex";
import { ENTITY_TYPE_LABEL, ENTITY_TYPE_COLOR, edgeLabel } from "../../lib/entityGraph";
import { atlasHref, actorHref } from "@/lib/routes";
import { ActorChain } from "./ActorChain";
import { ActorContact } from "./ActorContact";
import { ActorResponsibilities } from "./ActorResponsibilities";
import { ActorRewards } from "./ActorRewards";
import { ActorInstances } from "./ActorInstances";
import { ActorHistory, HISTORY_PREVIEW } from "./ActorHistory";
import { ActorOmni } from "./ActorOmni";
import { ActorSettlementTeaser } from "./ActorSettlementTeaser";

interface Props {
  profile: ActorProfile;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2
        className="mono text-[10px] uppercase tracking-wider mb-3"
        style={{ color: "var(--tan-3)" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function RelationRow({ r }: { r: ActorRelation }) {
  const label = edgeLabel(r.edge.e, r.direction);
  const arrow = r.direction === "outbound" ? "→" : "←";
  return (
    <div className="flex items-center gap-2 py-1 border-t border-[var(--border)] text-sm">
      <span className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        <span className="enlargen">{arrow}</span> {label}
      </span>
      {r.otherSlug ? (
        <Link to={actorHref(r.otherSlug)} className="text-accent hover:underline">
          {r.otherLabel}
        </Link>
      ) : (
        <span style={{ color: "var(--tan-2)" }}>{r.otherLabel}</span>
      )}
    </div>
  );
}

function RecRow({ rec }: { rec: Recommendation }) {
  return (
    <div className="flex items-start gap-2 py-1 border-t border-[var(--border)] text-sm">
      <span style={{ color: "var(--accent)" }}>▲</span>
      <div>
        <span style={{ color: "var(--tan-2)" }}>{rec.label}</span>
        {rec.reportLink && (
          <Link to={rec.reportLink} className="mono text-[10px] text-accent hover:underline ml-2">
            view report <span className="enlargen">→</span>
          </Link>
        )}
        {rec.entityLink && (
          <Link
            to={actorHref(rec.entityLink)}
            className="mono text-[10px] text-accent hover:underline ml-2"
          >
            view actor <span className="enlargen">→</span>
          </Link>
        )}
        <div className="text-xs mt-0.5" style={{ color: "var(--tan-3)" }}>
          {rec.detail}
        </div>
      </div>
    </div>
  );
}

export function ActorDashboard({ profile }: Props) {
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const el = document.getElementById(hash);
    el?.scrollIntoView({ behavior: "instant", block: "start" });
  });

  const {
    entity,
    definingDoc,
    chain,
    adRows,
    rewardsAgent,
    relations,
    primitives,
    recommendations,
    comprisesMembers,
    partOfComposite,
  } = profile;
  const color = ENTITY_TYPE_COLOR[entity.et] ?? "var(--entity-fallback)";
  const typeLabel =
    entity.et === "agent"
      ? entity.st === "prime"
        ? "Prime Agent"
        : "Executor Agent"
      : (ENTITY_TYPE_LABEL[entity.et] ?? entity.et);

  return (
    <div className="flex-1 px-6 py-6 min-w-0">
      <div className="max-w-6xl mx-auto">
        <div className="min-w-0">
          {/* Header, full width above the masonry. */}
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
        </div>

        {/* A masonry: one multi-column flow of blocks, each kept whole by
            `break-inside-avoid`. The browser fills the columns and balances
            their heights, so no block leaves a dead tail under it — and the
            column count follows the width, so the same blocks fall into two
            columns on a wide screen and one on a narrow one with nothing to
            reorder. A grid or a float had to be told which side each section
            lived on, and whichever side ran out first left the gap. */}
        <div className="actor-masonry min-w-0">
          <div className="break-inside-avoid mb-6">
            <ActorChain chain={chain} currentSlug={entity.slug} />
          </div>

          <div className="break-inside-avoid">
            {/* Null if no MSC workbook. */}
            <ActorSettlementTeaser slug={entity.slug} name={entity.name} />
          </div>

          <div className="break-inside-avoid">
            <ActorOmni topics={profile.omni} />
          </div>
          <div className="break-inside-avoid">
            <ActorContact contact={profile.contact} />
          </div>

          <div className="break-inside-avoid">
            <Section title={"History of Doc Changes affecting " + entity.name}>
              <ActorHistory profile={profile} limit={HISTORY_PREVIEW} />
            </Section>
          </div>

          {relations.length > 0 && (
            <div className="break-inside-avoid">
              <Section title="Relationships">
                {relations.map((r, i) => (
                  <RelationRow key={i} r={r} />
                ))}
              </Section>
            </div>
          )}
          {recommendations.length > 0 && (
            <div className="break-inside-avoid">
              <Section title="Notable">
                {recommendations.map((rec, i) => (
                  <RecRow key={i} rec={rec} />
                ))}
              </Section>
            </div>
          )}

          {entity.et === "composite_party" && (
            <div className="break-inside-avoid">
            <Section title="Composite Party">
              <p className="text-sm mb-3" style={{ color: "var(--tan-2)" }}>
                A composite party is the named legal counterparty in a Sky{" "}
                <AtlasLink to={atlasHref("104c3543-ce94-4a2f-9968-57f1ee858085")} className="text-accent hover:underline">
                  Ecosystem Accord
                </AtlasLink>
                {" "}— an agreement between Sky Ecosystem actors that is enforceable by Sky Governance. It may comprise the Prime Agent and associated legal entities (foundation, development company) acting together as a single party to the accord.
              </p>
              {comprisesMembers.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {comprisesMembers.map((m) =>
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
            </div>
          )}

          {/* Primitives is last in the masonry and is the only block allowed
              to split across columns — it is the open-ended one, so it is
              what fills whatever the fixed blocks left. Its own primitives
              stay whole (`break-inside-avoid` inside ActorInstances). */}
          {primitives.length > 0 && (
            <Section title="Primitives">
              <ActorInstances primitives={primitives} />
            </Section>
          )}
        </div>

        {/* The two wide tables sit under the masonry at full width: both are
            640px+ of columns that would only gain a horizontal scrollbar from
            a masonry column. */}
        <div className="min-w-0">
          {adRows.length > 0 && (
            <Section title="Responsibilities">
              <ActorResponsibilities rows={adRows} />
            </Section>
          )}
          {rewardsAgent && (
            <Section title="Rewards">
              <ActorRewards agent={rewardsAgent} />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
