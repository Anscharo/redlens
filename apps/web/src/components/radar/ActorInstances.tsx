import { AtlasLink } from "../AtlasLink";
import type { RadarInstance, RadarPrimitive } from "../../lib/actorIndex";
import { toAnchorId } from "../../lib/anchorId";
import { atlasHref } from "@/lib/routes";
import { HEADER_OFFSET } from "../../lib/layout";
import { StatusPill } from "../reports/RewardsCells";
import { InstanceCard } from "./InstanceCard";
import type { PauPrime } from "./ParamAddressKeys";
import { RadarHeading } from "./RadarHeading";


interface Props {
  primitives: RadarPrimitive[];
  /** The prime whose page this is, for the on-chain keys an instance lists by address. */
  prime?: PauPrime;
}

interface CategoryGroup {
  category: string;
  categoryDocId: string | null;
  primitives: RadarPrimitive[];
}

function buildCategoryGroups(primitives: RadarPrimitive[]): CategoryGroup[] {
  // primitives arrive pre-sorted by category order, so a single linear pass
  // preserves the canonical Genesis → Operational → … sequence.
  const groups: CategoryGroup[] = [];
  for (const prim of primitives) {
    const cat = prim.category ?? "Other";
    const last = groups[groups.length - 1];
    if (last && last.category === cat) {
      last.primitives.push(prim);
    } else {
      groups.push({ category: cat, categoryDocId: prim.categoryDocId, primitives: [prim] });
    }
  }
  return groups;
}

// Invocations (InProgress) lead; they sit in the same list as the instances.
const INSTANCE_STATUS_ORDER = ["InProgress", "Active", "Suspended", "Completed"];

function instanceStatusRank(s: string | null): number {
  const i = INSTANCE_STATUS_ORDER.indexOf(s ?? "");
  return i === -1 ? INSTANCE_STATUS_ORDER.length : i;
}

/** A primitive's invocations and instances as one list. */
function itemsOf(prim: RadarPrimitive): RadarInstance[] {
  return [...prim.invocations, ...prim.instances];
}

/** Sort items by status and tag the first of each status group with an
 * anchor id (`distribution-reward-inprogress`, `distribution-reward-active`, …). */
function withStatusAnchors(
  prim: RadarPrimitive,
  items: RadarInstance[],
): Array<{ inst: RadarInstance; anchorId?: string }> {
  const sorted = [...items].sort((a, b) => instanceStatusRank(a.status) - instanceStatusRank(b.status));
  const seen = new Set<string>();
  return sorted.map((inst) => {
    const key = (inst.status ?? "unknown").toLowerCase();
    if (seen.has(key)) return { inst };
    seen.add(key);
    return { inst, anchorId: `${prim.st}-${key}` };
  });
}

interface SectionProps {
  /** Category groups whose primitives carry the items to render. */
  groups: CategoryGroup[];
  /** Rank of each category heading; primitives sit one below, items two. */
  level: number;
  prime?: PauPrime;
}

function ActorItemsSection({ groups, level, prime }: SectionProps) {
  const visibleGroups = groups
    .map((cat) => ({ ...cat, primitives: cat.primitives.filter((p) => itemsOf(p).length > 0) }))
    .filter((cat) => cat.primitives.length > 0);
  if (visibleGroups.length === 0) return null;

  return (
    <div className="space-y-6">
      {visibleGroups.map((cat) => (
        <div key={cat.category} id={toAnchorId(cat.category)} style={{ scrollMarginTop: HEADER_OFFSET }}>
          <RadarHeading level={level} className="flex items-center gap-2 mb-3">
            {cat.categoryDocId ? (
              <AtlasLink to={atlasHref(cat.categoryDocId)} className="mono text-[11px] uppercase tracking-wider hover:underline" style={{ color: "var(--tan-3)" }}>
                {cat.category}
              </AtlasLink>
            ) : (
              <span className="mono text-[11px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>{cat.category}</span>
            )}
          </RadarHeading>
          <div className="radar-prim-grid pl-3" style={{ borderLeft: "1px solid var(--border)" }}>
            {cat.primitives.map((prim) => {
              const items = itemsOf(prim);
              return (
                <div
                  key={prim.st}
                  id={prim.st}
                  data-span={items.length > 1 ? "row" : undefined}
                  className="min-w-0"
                  style={{ scrollMarginTop: HEADER_OFFSET }}
                >
                  <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                    <RadarHeading level={level + 1}>
                      {prim.docId ? (
                        <AtlasLink to={atlasHref(prim.docId)} className="mono text-[11px] hover:underline" style={{ color: "var(--accent)" }}>
                          {prim.title}
                        </AtlasLink>
                      ) : (
                        <span className="mono text-[11px]" style={{ color: "var(--accent)" }}>{prim.title}</span>
                      )}
                    </RadarHeading>
                    {prim.status && <StatusPill s={prim.status} />}
                    <span className="mono text-[10px]" style={{ color: "var(--tan-3)", opacity: 0.6 }}>({items.length})</span>
                    {prim.isUnknown && (
                      <span className="mono text-[10px] px-1 rounded" style={{ color: "var(--error-text)", border: "1px solid var(--red)" }} title="Not listed in Current Primitives (A.2.2.1.5.1)">unknown</span>
                    )}
                  </div>
                  <div style={{ columns: "520px", columnGap: "0.75rem" }}>
                    {withStatusAnchors(prim, items).map(({ inst, anchorId }) => (
                      <div
                        key={inst.id}
                        id={anchorId}
                        className="mb-2"
                        style={anchorId ? { scrollMarginTop: HEADER_OFFSET } : undefined}
                      >
                        <InstanceCard inst={inst} prime={prime} headingLevel={level + 2} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A Prime's primitives by category, under the page's h1. Each primitive lists
 *  its invocations and instances together, each labelled by its own status. */
export function ActorInstances({ primitives, prime }: Props) {
  const groups = buildCategoryGroups(primitives);

  return (
    <section id="instances" aria-label="Instances" style={{ scrollMarginTop: HEADER_OFFSET }}>
      <ActorItemsSection groups={groups} level={2} prime={prime} />
    </section>
  );
}
