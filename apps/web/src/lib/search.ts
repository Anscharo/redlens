import type { GraphEntity, RelationEdge, EntitySearchHit } from "@/types";
import { actorHref, atlasHref } from "@/lib/routes";
import { counterpartTerm } from "@/lib/searchInflect";

/** Overlay on the search page shows this many entity hits. Capped in the worker. */
export const ENTITY_SEARCH_CAP = 6;

const RADAR_ETS = new Set(["agent", "facilitator_org", "govops_org"]);
// Entity types that appear on an agent's radar page via comprises edges.
const COMPRISES_ETS = new Set(["composite_party", "foundation", "development_company"]);

/**
 * Returns a map of participant id → href for search entity hit links.
 * Sidebar actors get their own radar page; composite/foundation/dev-company
 * entities resolve to the agent's radar page via comprises edges; others fall
 * back to their defining atlas doc, or are omitted.
 */
export function buildParticipantLinks(
  participants: GraphEntity[],
  edges: RelationEdge[],
): Map<string, string> {
  const byId = new Map(participants.map((e) => [e.id, e]));
  const result = new Map<string, string>();

  for (const e of participants) {
    if (RADAR_ETS.has(e.et)) result.set(e.id, actorHref(e.slug));
  }

  // Two-pass over comprises edges:
  // Pass 1 — map composite_party to its agent's radar page.
  // Pass 2 — map foundation/dev_company to that composite_party's agent link.
  for (const edge of edges) {
    if (edge.e !== "comprises" || edge.ft !== "entity" || edge.tt !== "entity") continue;
    const from = byId.get(edge.f);
    const to = byId.get(edge.t);
    if (!from || !to || from.et !== "composite_party" || to.et !== "agent") continue;
    result.set(from.id, actorHref(to.slug));
  }
  for (const edge of edges) {
    if (edge.e !== "comprises" || edge.ft !== "entity" || edge.tt !== "entity") continue;
    const from = byId.get(edge.f);
    const to = byId.get(edge.t);
    if (!from || !to || from.et !== "composite_party" || !COMPRISES_ETS.has(to.et)) continue;
    const agentLink = result.get(from.id);
    if (agentLink) result.set(to.id, agentLink);
  }

  // Fallback: defining atlas doc for anything still unmapped.
  for (const e of participants) {
    if (!result.has(e.id) && e.did) result.set(e.id, atlasHref(e.did));
  }

  return result;
}

interface EntityMatch {
  participant: GraphEntity;
  score: number; // 3 exact, 2 prefix, 1 substring
}

/** Attach hrefs and drop unlinkable rows, then cap. Used by the graph worker. */
export function toEntitySearchHits(
  matches: EntityMatch[],
  links: ReadonlyMap<string, string>,
  cap = ENTITY_SEARCH_CAP,
): EntitySearchHit[] {
  const hits: EntitySearchHit[] = [];
  for (const m of matches) {
    const href = links.get(m.participant.id);
    if (!href) continue;
    hits.push({ participant: m.participant, score: m.score, href });
    if (hits.length >= cap) break;
  }
  return hits;
}

function nameTokens(name: string): string[] {
  return name.split(/\s+/).filter(Boolean);
}

function tokenHits(queryToken: string, nameToken: string): boolean {
  if (nameToken === queryToken || nameToken.startsWith(queryToken) || nameToken.includes(queryToken)) {
    return true;
  }
  const extra = counterpartTerm(queryToken);
  if (extra && (nameToken === extra || nameToken.startsWith(extra) || nameToken.includes(extra))) {
    return true;
  }
  return false;
}

export function matchParticipants(query: string, participants: GraphEntity[]): EntityMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qTokens = q.split(/\s+/).filter(Boolean);
  const hits: EntityMatch[] = [];
  for (const e of participants) {
    const name = e.name.toLowerCase();
    let score = 0;
    if (name === q) score = 3;
    else if (name.startsWith(q)) score = 2;
    else if (name.includes(q)) score = 1;
    else if (qTokens.every((qt) => nameTokens(name).some((nt) => tokenHits(qt, nt)))) score = 1;
    if (score > 0) hits.push({ participant: e, score });
  }
  return hits.sort(
    (a, b) => b.score - a.score || a.participant.name.length - b.participant.name.length,
  );
}

