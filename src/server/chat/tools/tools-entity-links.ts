// atlas_entity's linked-document lists, beside its address block
// (tools-entity-addresses.ts): what an entity is responsible for, and the
// Active Data it controls. Not cut here; atlasEntity fits them to the call's budget.
import type { AtlasNode, Indexes } from "../../retrieval/indexes.ts";

/** Slim node row for tool responses. */
export function docRow(n: AtlasNode) {
  return { id: n.id, doc_no: n.doc_no, title: n.title, type: n.type, depth: n.depth };
}

/** The docs an entity is responsible for, and the Active Data it controls. */
export function linkedDocs(ix: Indexes, entityId: string) {
  const out = ix.edges.filter((e) => e.from_id === entityId);
  const responsibilities = out
    .filter((e) => ["responsible_party_for", "process_step_responsible_party_for", "duty_for"].includes(e.edge_type))
    .map((e) => ix.docMap.get(e.to_id))
    .filter((n): n is AtlasNode => !!n)
    .map(docRow);
  const activeData = out.flatMap((e) => {
    const n = ix.docMap.get(e.to_id);
    return n && ["Active Data Controller", "Active Data"].includes(n.type) ? [{ ...docRow(n), edge_type: e.edge_type }] : [];
  });
  return { responsibilities, activeData };
}
