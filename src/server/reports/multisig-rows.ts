// One MultisigRow per multisig entity, for ./multisigs.ts.
import type { Indexes, Edge, Entity } from "../retrieval/indexes.ts";
import { parseMeta, parseDocNos } from "./util.ts";

interface SignerOrg {
  name: string;
  entity_type: string;
  signer_count: number | null;
  via_role: string | null;
}

interface MultisigRow {
  id: string;
  name: string;
  slug: string;
  chain: string | null;
  address: string | null;
  threshold: string | null; // e.g. "2/5"
  signer_orgs: SignerOrg[];
  signer_org_count: number;
  total_signers: number | null; // sum of per-org counts; null when none are stated
  can_modify_signers: Array<{ name: string; entity_type: string }>;
  purpose: { doc_no: string; title: string } | null;
  provenance?: {
    defining_doc_no: string | null;
    threshold_doc_no: string | null;
    purpose_doc_no: string | null;
    signer_docs: string[];
    modification_docs: string[];
  };
}

// Group the incoming edges we care about by their multisig endpoint in one pass.
export function incomingByType(ix: Indexes, edgeType: string): Map<string, Edge[]> {
  const byTarget = new Map<string, Edge[]>();
  for (const e of ix.edges) {
    if (e.edge_type !== edgeType) continue;
    const arr = byTarget.get(e.to_id);
    if (arr) arr.push(e);
    else byTarget.set(e.to_id, [e]);
  }
  return byTarget;
}

function signerOrgsOf(ix: Indexes, signerEdges: Edge[]): SignerOrg[] {
  return signerEdges
    .map((e) => {
      const org = ix.entityById.get(e.from_id);
      const m = parseMeta(e.meta);
      const count = typeof m.signer_count === "number" ? m.signer_count : null;
      return {
        name: org?.name ?? e.from_id,
        entity_type: org?.entity_type ?? e.from_type,
        signer_count: count,
        via_role: typeof m.via_role === "string" ? m.via_role : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Only sum when EVERY org states a count: a partial sum would silently
// undercount signers on a security-review report, so return null (unknown).
function totalSigners(signer_orgs: SignerOrg[]): number | null {
  const allCounted = signer_orgs.length > 0 && signer_orgs.every((s) => s.signer_count != null);
  return allCounted ? signer_orgs.reduce((sum, s) => sum + (s.signer_count ?? 0), 0) : null;
}

function modifiersOf(ix: Indexes, modifierEdges: Edge[]): MultisigRow["can_modify_signers"] {
  return modifierEdges
    .map((e) => {
      const org = ix.entityById.get(e.from_id);
      return { name: org?.name ?? e.from_id, entity_type: org?.entity_type ?? e.from_type };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const metaString = (meta: Record<string, unknown>, key: string): string | null =>
  typeof meta[key] === "string" ? (meta[key] as string) : null;

const edgeDocNos = (edges: Edge[]): string[] => [...new Set(edges.flatMap((e) => parseDocNos(e.source_doc_nos)))].sort();

interface MultisigEdges {
  signers: Edge[];
  modifiers: Edge[];
}

function purposeOf(ix: Indexes, purposeDocNo: string | null): MultisigRow["purpose"] {
  const purposeDoc = purposeDocNo ? ix.byDocNo.get(purposeDocNo) : undefined;
  return purposeDoc ? { doc_no: purposeDoc.doc_no, title: purposeDoc.title } : null;
}

function multisigProvenance(ix: Indexes, ms: Entity, meta: Record<string, unknown>, edges: MultisigEdges): MultisigRow["provenance"] {
  const definingDoc = ms.defining_doc_id ? ix.docMap.get(ms.defining_doc_id) : undefined;
  return {
    defining_doc_no: definingDoc?.doc_no ?? null,
    threshold_doc_no: metaString(meta, "threshold_doc_no"),
    purpose_doc_no: metaString(meta, "purpose_doc_no"),
    signer_docs: edgeDocNos(edges.signers),
    modification_docs: edgeDocNos(edges.modifiers),
  };
}

export function multisigRow(ix: Indexes, ms: Entity, edges: MultisigEdges, includeProvenance: boolean): MultisigRow {
  const meta = parseMeta(ms.meta);
  const signer_orgs = signerOrgsOf(ix, edges.signers);
  const row: MultisigRow = {
    id: ms.id,
    name: ms.name,
    slug: ms.slug,
    chain: metaString(meta, "chain"),
    address: metaString(meta, "address"),
    threshold: metaString(meta, "threshold"),
    signer_orgs,
    signer_org_count: signer_orgs.length,
    total_signers: totalSigners(signer_orgs),
    can_modify_signers: modifiersOf(ix, edges.modifiers),
    purpose: purposeOf(ix, metaString(meta, "purpose_doc_no")),
  };
  if (includeProvenance) row.provenance = multisigProvenance(ix, ms, meta, edges);
  return row;
}
