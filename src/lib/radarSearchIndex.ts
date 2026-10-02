import type { GraphEntity } from "@/types";
import type { GraphData } from "@/lib/graphData";
import { parseMeta } from "@/lib/meta";
import { actorHref } from "@/lib/routes";
import { EVM_ADDRESS_EXACT_RE, SOL_ADDRESS_EXACT_RE } from "@/lib/patterns";
import { buildOwnerIndex, instanceOwner, instanceSignalParams, isRelationEdge } from "@/lib/radarRules";
import { RADAR_SECTION, instanceAnchor } from "@/lib/radarAnchors";

export type RadarHitKind = "actor" | "instance" | "param" | "address" | "relationship";

export interface RadarHit {
  kind: RadarHitKind;
  label: string;
  /** Breadcrumb such as "Spark › Distribution Reward". */
  context: string;
  href: string;
  slug: string;
  anchor?: string;
  excerpt?: string;
}

export interface NameRow {
  name: string;
  hit: RadarHit;
}
export interface ParamRow {
  key: string;
  /** Value with markdown links reduced to their text. */
  value: string;
  hit: RadarHit;
}
export interface AddressRow {
  address: string;
  hit: RadarHit;
}
export interface RadarSearchIndex {
  actors: NameRow[];
  instances: NameRow[];
  relationships: NameRow[];
  params: ParamRow[];
  addresses: AddressRow[];
}

const MD_LINK = /\[([^\]]+)\]\([^)]*\)/g;
const words = (s: string) => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function isAddress(value: string): boolean {
  return EVM_ADDRESS_EXACT_RE.test(value) || SOL_ADDRESS_EXACT_RE.test(value);
}

function makeHit(
  kind: RadarHitKind,
  label: string,
  context: string,
  slug: string,
  anchor?: string,
): RadarHit {
  return { kind, label, context, slug, anchor, href: actorHref(slug, anchor) };
}

function instanceRows(graph: GraphData, out: RadarSearchIndex): void {
  const owners = buildOwnerIndex(graph);
  const seenParam = new Set<string>();
  for (const inst of [...graph.instances, ...graph.invocations]) {
    const found = instanceOwner(inst, owners);
    if (!found || !found.owner.slug) continue;
    const { owner, meta } = found;
    const anchor = instanceAnchor(inst.id);
    const where = `${owner.name} › ${inst.name}`;
    out.instances.push({
      name: inst.name,
      hit: makeHit("instance", inst.name, `${owner.name} › ${words(inst.st ?? "")}`, owner.slug, anchor),
    });
    for (const p of instanceSignalParams(meta)) {
      const value = p.value.replace(MD_LINK, "$1");
      const dedupe = `${owner.slug}#${anchor}|${p.key}`;
      if (seenParam.has(dedupe)) continue;
      seenParam.add(dedupe);
      out.params.push({ key: p.key, value, hit: makeHit("param", p.key, where, owner.slug, anchor) });
      if (isAddress(value.trim())) {
        const hit = makeHit("address", value.trim(), `${where} › ${p.key}`, owner.slug, anchor);
        out.addresses.push({ address: value.trim(), hit });
      }
    }
  }
}

function entityRows(graph: GraphData, out: RadarSearchIndex): void {
  const byId = new Map<string, GraphEntity>(graph.participants.map((e) => [e.id, e]));
  for (const p of graph.participants) {
    if (!p.slug) continue;
    out.actors.push({ name: p.name, hit: makeHit("actor", p.name, words(p.et), p.slug) });
    const address = parseMeta<{ address?: unknown }>(p.m)?.address;
    if (typeof address === "string" && isAddress(address)) {
      out.addresses.push({ address, hit: makeHit("address", address, p.name, p.slug) });
    }
  }
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (!isRelationEdge(edge, byId)) continue;
    const ends: [GraphEntity, GraphEntity][] = [
      [byId.get(edge.f)!, byId.get(edge.t)!],
      [byId.get(edge.t)!, byId.get(edge.f)!],
    ];
    for (const [page, other] of ends) {
      const key = `${page.id}|${other.id}|${edge.e}`;
      if (!page.slug || seen.has(key)) continue;
      seen.add(key);
      const context = `${page.name} › ${edge.e.replace(/_/g, " ")}`;
      out.relationships.push({
        name: other.name,
        hit: makeHit("relationship", other.name, context, page.slug, RADAR_SECTION.relationships),
      });
    }
  }
}

export function buildRadarSearchIndex(graph: GraphData): RadarSearchIndex {
  const out: RadarSearchIndex = { actors: [], instances: [], relationships: [], params: [], addresses: [] };
  entityRows(graph, out);
  instanceRows(graph, out);
  return out;
}
