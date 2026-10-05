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
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { rowsEnvelope } from "./util.ts";
import { incomingByType, multisigRow } from "./multisig-rows.ts";
import { defineReportTool } from "./report-tool.ts";

export function buildMultisigsReport(ix: Indexes, opts: { include_provenance: boolean }): ToolResult {
  const signersByMs = incomingByType(ix, "signer_of");
  const modifiersByMs = incomingByType(ix, "can_modify_signers_of");
  const rows = ix.entities
    .filter((e) => e.entity_type === "multisig")
    .map((ms) => {
      const edges = { signers: signersByMs.get(ms.id) ?? [], modifiers: modifiersByMs.get(ms.id) ?? [] };
      return multisigRow(ix, ms, edges, opts.include_provenance);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return rowsEnvelope("multisigs", rows, "multisigs");
}

export const multisigsTool = defineReportTool({
  name: "atlas_report_multisigs",
  title: "Atlas Report Multisigs",
  description:
    "Curated report (not raw graph calls) — every multisig in one call, the full evidence for a security review. " +
    "Each row: identity, chain/address, threshold, signer orgs with counts, who can modify signers, purpose. " +
    "Provenance (source doc_nos) only with include_provenance:true.",
  promptBlurb:
    "every multisig with its chain and on-chain address, threshold, signer orgs + counts, modification authorities, purpose, provenance — multisig and security-review questions.",
  params: ["include_provenance"],
  build: buildMultisigsReport,
});
