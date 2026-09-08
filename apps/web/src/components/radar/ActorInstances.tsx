import { useMemo } from "react";
import { AtlasLink } from "../AtlasLink";
import { prepareWithSegments, measureNaturalWidth } from "@chenglou/pretext";
import type { RadarInstance, RadarPrimitive, InstanceParam } from "../../lib/actorIndex";
import { toAnchorId } from "../../lib/anchorId";
import { atlasHref } from "@/lib/routes";
import { Address } from "../Address";
import { useAddressMap } from "../../hooks/useAddressMap";
import type { AddressInfo } from "@/types";
import { HEADER_OFFSET } from "../../lib/layout";
import { StatusPill } from "../reports/RewardsCells";
import { EVM_ADDRESS_EXACT_RE, SOL_ADDRESS_EXACT_RE } from "@/lib/patterns";

// Whole-string address shape tests — sourced from patterns.ts (the src-side
// home for these forms) so this doesn't drift into its own copy.
const EVM_RE = EVM_ADDRESS_EXACT_RE;
const SOL_RE = SOL_ADDRESS_EXACT_RE;
const RATE_LIMIT_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const PLACEHOLDER_RE = /will be specified in a future iteration/i;
const PARAM_FONT = '10px "Source Code Pro", monospace';
const MIN_DOTS_PX = 30;

function measureKeyPx(key: string): number {
  try { return measureNaturalWidth(prepareWithSegments(key, PARAM_FONT)); }
  catch { return key.length * 6; }
}

function renderValue(
  value: string,
  chainHint?: Array<string | undefined>,
  addrMap?: Record<string, AddressInfo>,
): React.ReactNode {
  if (EVM_RE.test(value) || SOL_RE.test(value)) {
    // addrMap is the build pipeline's resolved chain and outranks every hint —
    // an instance's *name* is not evidence of where it is deployed. The "Grove
    // Arbitrum Governance Relay Receiver" lives on Robinhood Chain, and naming
    // it after the governance it relays sent its address to arbiscan for as
    // long as the name was the only thing consulted.
    return <Address address={value} chain={chainHint} addrMap={addrMap} />;
  }
  if (RATE_LIMIT_HASH_RE.test(value.trim())) {
    const v = value.trim();
    return <span title={v}>{v.slice(0, 10)}…{v.slice(-6)}</span>;
  }
  if (PLACEHOLDER_RE.test(value)) {
    return <span style={{ color: "var(--tan-3)", fontStyle: "italic" }}>To Be Specified</span>;
  }
  if (value.includes("](")) {
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (const m of value.matchAll(MD_LINK_RE)) {
      const idx = m.index ?? 0;
      if (idx > last) parts.push(value.slice(last, idx));
      const [, text, href] = m;
      parts.push(UUID_RE.test(href)
        ? <AtlasLink key={idx} to={atlasHref(href)} className="text-accent hover:underline">{text}</AtlasLink>
        : <a key={idx} href={href} target="_blank" rel="noopener" className="text-accent hover:underline">{text}</a>
      );
      last = idx + m[0].length;
    }
    if (last < value.length) parts.push(value.slice(last));
    return <>{parts}</>;
  }
  return value;
}

function ParamLine({ p, colWidth, instanceHint, addrMap }: { p: InstanceParam; colWidth: number; instanceHint: string; addrMap: Record<string, AddressInfo> }) {
  return (
    <div className="flex py-0.5 w-full items-baseline">
      <span className="mono text-[10px] shrink-0" style={{ color: "var(--tan-3)" }}>
        {p.key}
      </span>
      <span className="flex-1 min-w-0" style={{ borderBottom: "1px dotted color-mix(in srgb, var(--tan-3) 25%, transparent)", margin: "0 4px 3px" }} />
      <span
        className="mono text-[10px] shrink-0 text-right leading-relaxed"
        style={{ maxWidth: `calc(100% - ${colWidth}px)`, wordBreak: "break-word", color: "var(--tan-2)" }}
      >
        {/* Param key first: it's the more specific signal (e.g. "Token Address
            (Avalanche)" on an instance whose name says "Ethereum Mainnet - …"
            names the token's own chain, not the instance's home chain). Falls
            back to the instance name when the key carries no chain hint. */}
        {renderValue(p.value, [p.key, instanceHint], addrMap)}
      </span>
    </div>
  );
}

function InstanceCard({ inst }: { inst: RadarInstance }) {
  // Loaded here rather than drilled from ActorInstances: loadAddresses() is
  // module-cached, so every card resolves from the one in-flight request.
  const addrMap = useAddressMap();
  const colWidth = useMemo(() => {
    if (inst.signalParams.length === 0) return MIN_DOTS_PX;
    return Math.max(...inst.signalParams.map((p) => measureKeyPx(p.key))) + MIN_DOTS_PX;
  }, [inst.signalParams]);

  return (
    <div className="rounded p-3 break-inside-avoid" style={{ background: "var(--bg-deep)", border: "1px solid var(--border)", maxWidth: "600px" }}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {inst.docId ? (
          <AtlasLink to={atlasHref(inst.docId)} className="text-sm hover:underline" style={{ color: "var(--tan)" }}>
            {inst.displayName}
          </AtlasLink>
        ) : (
          <span className="text-sm" style={{ color: "var(--tan)" }}>{inst.displayName}</span>
        )}
        {inst.status && <StatusPill s={inst.status} />}
      </div>
      {inst.signalParams.length > 0 && (
        <div>
          {inst.signalParams.map((p) => <ParamLine key={p.key} p={p} colWidth={colWidth} instanceHint={inst.displayName} addrMap={addrMap} />)}
        </div>
      )}
    </div>
  );
}

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
