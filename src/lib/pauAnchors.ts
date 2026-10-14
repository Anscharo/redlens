// Fragment ids on a Prime's PAUs page (/radar/<slug>/pau#…), readable and
// stable across reads. A deployment is its chain, with its generation added
// when the chain has two; its sections are named under it. A change-history
// group is what made it and when, with -2, -3… for a repeat counted from the
// oldest, so a later group never renumbers an earlier link. Aliases resolve
// through `data-anchor-alias` (useArrivalTarget.ts): a bare section name to the
// first deployment showing it, a chain to its first deployment, a spell's
// address to its executive's group.
import type { PauSnapshot } from "./pau.ts";
import type { TimelineGroup } from "./pauTimeline.ts";

export const PAU_ANCHOR = { currentState: "current-state", changeHistory: "change-history" } as const;

export type PauSection = "roles" | "facets" | "rate-limits" | "configurator-limits" | "parameters";

export interface Anchor {
  id: string;
  aliases: string[];
}

const PAU_FRAGMENT = /^(?:current-state|change-history|pau-history|roles|facets|rate-limits|configurator-limits|parameters|exec-vote-\d{4}-\d{2}-\d{2}(?:-\d+)?|spell-0x[0-9a-f]{40})$/;

/** Whether a fragment names a part of the PAUs page that a Prime's other pages do not have, so a link to it there can be forwarded. */
export const isPauFragment = (id: string): boolean => PAU_FRAGMENT.test(id.toLowerCase());

/** Each deployment's anchor by deployment id. */
export function deploymentAnchors(snaps: Pick<PauSnapshot, "deployment" | "chain" | "kind">[]): Map<string, Anchor> {
  const perChain = new Map<string, number>();
  for (const s of snaps) perChain.set(s.chain, (perChain.get(s.chain) ?? 0) + 1);
  return new Map(snaps.map((s) => [s.deployment, perChain.get(s.chain)! > 1 ? { id: `${s.chain}-${s.kind}`, aliases: [s.chain] } : { id: s.chain, aliases: [] }]));
}

/** A section of a deployment: its own id, and the bare section name and the chain's name for it as aliases. */
export const sectionAnchor = (deployment: Anchor, section: PauSection): Anchor => ({
  id: `${deployment.id}-${section}`,
  aliases: [section, ...deployment.aliases.map((a) => `${a}-${section}`)],
});

const day = (time: string) => time.slice(0, 10);

/** When a group began: its oldest entry. A later change can join a group but never move its start, so anchors keyed on it hold. */
const started = (g: TimelineGroup) => g.entries[0]?.time ?? g.time;

function baseAnchor(g: TimelineGroup): string {
  const chain = g.entries[0]?.chain ?? "unknown";
  if (g.kind === "executive") return g.executive?.date ? `exec-vote-${g.executive.date}` : `spell-${g.spell?.toLowerCase()}`;
  if (g.kind === "unknown") return `unattributed-${chain}`;
  if (g.kind === "deployment") return `deployment-${chain}`;
  return `${g.kind}-${chain}-${day(started(g))}`;
}

/** Each change-history group's anchor by group key; an executive's spell address is an alias. */
export function groupAnchors(groups: TimelineGroup[]): Map<string, Anchor> {
  const seen = new Map<string, number>();
  const out = new Map<string, Anchor>();
  for (const g of [...groups].sort((a, b) => started(a).localeCompare(started(b)))) {
    const base = baseAnchor(g);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const spell = g.kind === "executive" && g.executive?.date && g.spell ? [`spell-${g.spell.toLowerCase()}`] : [];
    out.set(g.key, { id: n === 1 ? base : `${base}-${n}`, aliases: spell });
  }
  return out;
}
