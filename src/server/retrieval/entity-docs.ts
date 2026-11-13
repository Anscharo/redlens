// The documents that are "about" an entity: the ones its own edges point at,
// and its defining document's subtree (a Prime Agent's whole artifact). The
// entity tool, the history tools' entity filter and atlas_query's entity scope
// read this one set, so a question scoped to an actor means the same documents
// in each.
import { descendantIds, type Indexes } from "./indexes.ts";

interface EntityRef {
  id: string;
  defining_doc_id: string | null;
}

/**
 * Edge-linked documents first, then the defining-doc subtree, each once. An
 * entity's id often equals its defining doc's id, so an edge counts only when
 * its source is declared `entity`: the doc's own `cites` and `instance_of`
 * edges are not the entity's (the same guard as `entityDocs` in query.ts).
 */
export function entityScopeDocIds(ix: Indexes, entity: EntityRef): string[] {
  const ids = new Set<string>();
  for (const e of ix.edges) if (e.from_id === entity.id && e.from_type === "entity" && e.to_type === "doc" && ix.docMap.has(e.to_id)) ids.add(e.to_id);
  if (entity.defining_doc_id) for (const id of descendantIds(ix, entity.defining_doc_id)) if (ix.docMap.has(id)) ids.add(id);
  return [...ids];
}

/** The defining-doc subtree alone, optionally of one document type. */
export function artifactDocIds(ix: Indexes, entityId: string, type?: string): string[] {
  const root = ix.entityById.get(entityId)?.defining_doc_id;
  if (!root) return [];
  return [...descendantIds(ix, root)].filter((id) => !type || ix.docMap.get(id)?.type === type);
}

export interface OutsideScope {
  outside_entity_scope: { note: string; matches: { id: string; doc_no: string; title: string }[] };
}

/**
 * What a query matched outside an entity's documents, when it matched nothing
 * inside them. Documents about an actor also sit outside its artifact (a
 * primitive's per-agent section in the Support Scope), so an empty scoped
 * search hands back the nearest unscoped matches instead of reading as silence.
 */
export function outsideScope(ix: Indexes, name: string, allHits: { id: string }[], scopedCount: number): OutsideScope | Record<string, never> {
  if (scopedCount > 0 || allHits.length === 0) return {};
  const matches = allHits.slice(0, 5).flatMap((h) => {
    const n = ix.docMap.get(h.id);
    return n ? [{ id: n.id, doc_no: n.doc_no, title: n.title }] : [];
  });
  const note = `No match sits in ${name}'s own documents (its artifact and the documents its edges link), but the query matched ${allHits.length} document(s) elsewhere. The atlas is not silent: read the matches below with atlas_get, or search again without \`entity\` and with "${name}" in the query.`;
  return { outside_entity_scope: { note, matches } };
}
