// Groups one prime's PAU change history (pauHistory.ts) for the Radar
// timeline, newest first:
//   - a spell's changes on every chain form one group under its executive;
//   - an operator's run of Configurator changes, uninterrupted by any other
//     change of this prime, forms one group;
//   - a relayed action set without a proven spell, an unresolved change and
//     any later direct call each stand alone;
//   - contract creations, and direct calls made before a deployment's first
//     governed change (spell, relay or operator), are its "Deployment" group.
// Pure.
import type { ExecutiveRef, PauHistoryEntry, PauHistoryResponse } from "./pauHistory.ts";

export type GroupKind = "executive" | "relayed" | "operator" | "deployment" | "direct" | "unknown";

export interface TimelineGroup {
  key: string;
  kind: GroupKind;
  /** The latest entry's time; groups sort by it. */
  time: string;
  spell: string | null;
  executive: ExecutiveRef | null;
  entries: PauHistoryEntry[];
}

const GOVERNED = new Set(["spell", "relayed", "operator"]);
const firstDeployment = (e: PauHistoryEntry) => e.changes.find((c) => c.deployments.length)?.deployments[0] ?? `${e.chain}:unregistered`;

/** Each deployment's first governed change, by time. */
function governedSince(entries: PauHistoryEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of entries) {
    if (!GOVERNED.has(e.origin?.kind ?? "")) continue;
    for (const d of e.changes.flatMap((c) => c.deployments)) if (!out.has(d) || e.time < out.get(d)!) out.set(d, e.time);
  }
  return out;
}

function groupOf(e: PauHistoryEntry, since: Map<string, string>): Pick<TimelineGroup, "key" | "kind" | "spell"> {
  const o = e.origin;
  if (o?.kind === "spell" && o.spell) return { key: `spell:${o.spell}`, kind: "executive", spell: o.spell };
  if (o?.kind === "deployment") return { key: `deployment:${firstDeployment(e)}`, kind: "deployment", spell: null };
  if (o?.kind === "direct") {
    const ds = e.changes.flatMap((c) => c.deployments);
    const setup = ds.length > 0 && ds.every((d) => !since.has(d) || e.time <= since.get(d)!);
    if (setup) return { key: `deployment:${firstDeployment(e)}`, kind: "deployment", spell: null };
  }
  if (o?.kind === "operator") return { key: `operator:${e.chain}:${o.to}:${e.tx}`, kind: "operator", spell: null };
  const kind = (o?.kind ?? "unknown") as GroupKind;
  return { key: `${kind}:${e.chain}:${e.tx}`, kind, spell: null };
}

const sameOperator = (a: PauHistoryEntry, b: PauHistoryEntry) => a.chain === b.chain && a.origin?.to === b.origin?.to;

/** One prime's timeline groups, newest first; entries inside a group oldest first. */
export function timelineFor(res: PauHistoryResponse, prime: string): TimelineGroup[] {
  const mine = res.entries.filter((e) => e.primes.includes(prime));
  const since = governedSince(mine);
  const groups = new Map<string, TimelineGroup>();
  let prev: TimelineGroup | undefined;
  for (const e of mine) {
    const g = groupOf(e, since);
    if (g.kind === "operator" && prev?.kind === "operator" && sameOperator(prev.entries[0], e)) g.key = prev.key;
    const group = groups.get(g.key) ?? { ...g, time: e.time, executive: e.executive, entries: [] };
    group.entries.push(e);
    if (e.time > group.time) group.time = e.time;
    groups.set(g.key, group);
    prev = group;
  }
  return [...groups.values()].sort((a, b) => b.time.localeCompare(a.time));
}
