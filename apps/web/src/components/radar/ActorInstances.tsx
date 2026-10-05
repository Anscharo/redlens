import { AtlasLink } from "../AtlasLink";
import type { RadarInstance, RadarPrimitive } from "../../lib/actorIndex";
import { toAnchorId } from "../../lib/anchorId";
import { atlasHref } from "@/lib/routes";
import { HEADER_OFFSET } from "../../lib/layout";
import { StatusPill } from "../reports/RewardsCells";
import { InstanceCard } from "./InstanceCard";


interface Props {
  primitives: RadarPrimitive[];
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

const INSTANCE_STATUS_ORDER = ["Active", "Suspended", "Completed"];

function instanceStatusRank(s: string | null): number {
  const i = INSTANCE_STATUS_ORDER.indexOf(s ?? "");
  return i === -1 ? INSTANCE_STATUS_ORDER.length : i;
}

/** Sort instances by status and tag the first of each status group with an
 * anchor id (`distribution-reward-active`, `distribution-reward-suspended`, …).
 * In the Invocations section all items share one status (InProgress) so the
 * sort is a no-op and one anchor fires. */
function withStatusAnchors(
  prim: RadarPrimitive,
  items: RadarInstance[],
  anchorPrefix: string,
): Array<{ inst: RadarInstance; anchorId?: string }> {
  const sorted = [...items].sort((a, b) => instanceStatusRank(a.status) - instanceStatusRank(b.status));
  const seen = new Set<string>();
  return sorted.map((inst) => {
    const key = (inst.status ?? "unknown").toLowerCase();
    if (seen.has(key)) return { inst };
    seen.add(key);
    // Empty anchorPrefix → bare `#<primitive-st>-<status>` (Instances section, the default).
    // Non-empty → `#<anchorPrefix>-<primitive-st>-<status>` (e.g. Invocations).
    const id = anchorPrefix ? `${anchorPrefix}-${prim.st}-${key}` : `${prim.st}-${key}`;
    return { inst, anchorId: id };
  });
}

interface SectionProps {
  /** Category groups whose primitives carry the items to render. */
  groups: CategoryGroup[];
  /** Which list off each primitive to render. */
  pick: (prim: RadarPrimitive) => RadarInstance[];
  /** Anchor namespace. Empty for Instances (the default surface) so anchors
   * like `#distribution-reward-active` are bare. Non-empty (e.g. "Invocations")
   * for sibling sections so the primitive anchor becomes
   * `#Invocations-distribution-reward`. */
  anchorPrefix: string;
}

function ActorItemsSection({ groups, pick, anchorPrefix }: SectionProps) {
  const visibleGroups = groups
    .map((cat) => ({ ...cat, primitives: cat.primitives.filter((p) => pick(p).length > 0) }))
    .filter((cat) => cat.primitives.length > 0);
  if (visibleGroups.length === 0) return null;

  const catId = (cat: CategoryGroup) =>
    anchorPrefix ? `${anchorPrefix}-${toAnchorId(cat.category)}` : toAnchorId(cat.category);
  const primId = (prim: RadarPrimitive) =>
    anchorPrefix ? `${anchorPrefix}-${prim.st}` : prim.st;

  return (
    <div className="space-y-6">
      {visibleGroups.map((cat) => (
        <div key={cat.category} id={catId(cat)} style={{ scrollMarginTop: HEADER_OFFSET }}>
          <div className="flex items-center gap-2 mb-3">
            {cat.categoryDocId ? (
              <AtlasLink to={atlasHref(cat.categoryDocId)} className="mono text-[11px] uppercase tracking-wider hover:underline" style={{ color: "var(--tan-3)" }}>
                {cat.category}
              </AtlasLink>
            ) : (
              <span className="mono text-[11px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>{cat.category}</span>
            )}
          </div>
          <div className="space-y-4 pl-3" style={{ borderLeft: "1px solid var(--border)" }}>
            {cat.primitives.map((prim) => {
              const items = pick(prim);
              return (
                <div key={prim.st} id={primId(prim)} style={{ scrollMarginTop: HEADER_OFFSET }}>
                  <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                    {prim.docId ? (
                      <AtlasLink to={atlasHref(prim.docId)} className="mono text-[11px] hover:underline" style={{ color: "var(--accent)" }}>
                        {prim.title}
                      </AtlasLink>
                    ) : (
                      <span className="mono text-[11px]" style={{ color: "var(--accent)" }}>{prim.title}</span>
                    )}
                    {prim.status && <StatusPill s={prim.status} />}
                    <span className="mono text-[10px]" style={{ color: "var(--tan-3)", opacity: 0.6 }}>({items.length})</span>
                    {prim.isUnknown && (
                      <span className="mono text-[10px] px-1 rounded" style={{ color: "var(--error-text)", border: "1px solid var(--red)" }} title="Not listed in Current Primitives (A.2.2.1.5.1)">unknown</span>
                    )}
                  </div>
                  <div style={{ columns: "520px", columnGap: "0.75rem" }}>
                    {withStatusAnchors(prim, items, anchorPrefix).map(({ inst, anchorId }) => (
                      <div
                        key={inst.id}
                        id={anchorId}
                        className="mb-2"
                        style={anchorId ? { scrollMarginTop: HEADER_OFFSET } : undefined}
                      >
                        <InstanceCard inst={inst} />
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

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 mb-4">
      <h2 className="text-sm font-medium" style={{ color: "var(--tan)" }}>{label}</h2>
      <span className="mono text-[11px]" style={{ color: "var(--tan-3)" }}>({count})</span>
    </div>
  );
}

export function ActorInstances({ primitives }: Props) {
  const groups = buildCategoryGroups(primitives);
  const instanceCount = primitives.reduce((n, p) => n + p.instances.length, 0);
  const invocationCount = primitives.reduce((n, p) => n + p.invocations.length, 0);

  return (
    <div className="space-y-8">
      {invocationCount > 0 && (
        <section id="invocations" style={{ scrollMarginTop: HEADER_OFFSET }}>
          <SectionHeading label="Invocations" count={invocationCount} />
          <ActorItemsSection groups={groups} pick={(p) => p.invocations} anchorPrefix="invocations" />
        </section>
      )}
      <section id="instances" style={{ scrollMarginTop: HEADER_OFFSET }}>
        <SectionHeading label="Instances" count={instanceCount} />
        <ActorItemsSection groups={groups} pick={(p) => p.instances} anchorPrefix="" />
      </section>
    </div>
  );
}
