// Curated multisig security-review report. Complete data already lives in the
// graph — this collapses what would otherwise be an N+1 sweep (one multisig
// entity + its signer_of / can_modify_signers_of / has_address edges each) into
// a single model-ready rollup with provenance.
//
// Source shapes (all from build-graph, see scripts/lib/graph-multisigs.mjs):
//   entity et=multisig  meta { address, chain, threshold, threshold_doc_no, purpose_doc_no }
//   edge  signer_of              signer entity → multisig   meta { signer_count, via_role? }
//   edge  can_modify_signers_of  entity → multisig
//   entity.defining_doc_id       root doc UUID
import type { Indexes, Edge } from "../indexes.ts";
import { fitToBudget, TRUNCATION_HINT } from "../output-budget.ts";
import type { ToolResult } from "../tools.ts";

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// source_doc_nos is a JSON array string (current build) or a legacy comma list.
function parseDocNos(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // fall through to legacy comma-split
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

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
function incomingByType(ix: Indexes, edgeType: string): Map<string, Edge[]> {
  const byTarget = new Map<string, Edge[]>();
  for (const e of ix.edges) {
    if (e.edge_type !== edgeType) continue;
    const arr = byTarget.get(e.to_id);
    if (arr) arr.push(e);
    else byTarget.set(e.to_id, [e]);
  }
  return byTarget;
}

export function buildMultisigsReport(ix: Indexes, opts: { include_provenance: boolean }): ToolResult {
  const signersByMs = incomingByType(ix, "signer_of");
  const modifiersByMs = incomingByType(ix, "can_modify_signers_of");

  const rows: MultisigRow[] = ix.entities
    .filter((e) => e.entity_type === "multisig")
    .map((ms) => {
      const meta = parseMeta(ms.meta);

      const signerEdges = signersByMs.get(ms.id) ?? [];
      const signer_orgs: SignerOrg[] = signerEdges
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

      // Only sum when EVERY org states a count. A partial sum on a security-
      // review report would silently undercount signers — better to return null
      // (unknown) than a number that looks authoritative but isn't.
      const allCounted = signer_orgs.length > 0 && signer_orgs.every((s) => s.signer_count != null);
      const total_signers = allCounted
        ? signer_orgs.reduce((sum, s) => sum + (s.signer_count ?? 0), 0)
        : null;

      const modifierEdges = modifiersByMs.get(ms.id) ?? [];
      const can_modify_signers = modifierEdges
        .map((e) => {
          const org = ix.entityById.get(e.from_id);
          return { name: org?.name ?? e.from_id, entity_type: org?.entity_type ?? e.from_type };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const purposeDocNo = typeof meta.purpose_doc_no === "string" ? meta.purpose_doc_no : null;
      const purposeDoc = purposeDocNo ? ix.byDocNo.get(purposeDocNo) : undefined;

      const row: MultisigRow = {
        id: ms.id,
        name: ms.name,
        slug: ms.slug,
        chain: typeof meta.chain === "string" ? meta.chain : null,
        address: typeof meta.address === "string" ? meta.address : null,
        threshold: typeof meta.threshold === "string" ? meta.threshold : null,
        signer_orgs,
        signer_org_count: signer_orgs.length,
        total_signers,
        can_modify_signers,
        purpose: purposeDoc ? { doc_no: purposeDoc.doc_no, title: purposeDoc.title } : null,
      };

      if (opts.include_provenance) {
        const definingDoc = ms.defining_doc_id ? ix.docMap.get(ms.defining_doc_id) : undefined;
        row.provenance = {
          defining_doc_no: definingDoc?.doc_no ?? null,
          threshold_doc_no: typeof meta.threshold_doc_no === "string" ? meta.threshold_doc_no : null,
          purpose_doc_no: purposeDocNo,
          signer_docs: [...new Set(signerEdges.flatMap((e) => parseDocNos(e.source_doc_nos)))].sort(),
          modification_docs: [...new Set(modifierEdges.flatMap((e) => parseDocNos(e.source_doc_nos)))].sort(),
        };
      }
      return row;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const { kept, truncated } = fitToBudget(rows);
  const result: ToolResult = {
    report: "multisigs",
    total: rows.length,
    returned: kept.length,
    truncated,
    multisigs: kept,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
