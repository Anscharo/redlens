// Which rows should exist in an embeddings store for a set of documents, and
// what text each one embeds. ONE function for the live atlas
// (sync-embeddings.ts → atlas_doc_embeddings) and for a preview
// (preview/embeddings.ts → the bundle's embeddings.json): if the two planned
// their rows separately, a preview's vectors would stop being comparable to
// the live ones the moment either changed.
//
// Pure — no DB, no network.
import { config } from "../config.ts";
import type { AtlasNode } from "../../types.ts";
import { buildUnits, foldedIds, GROUP_POLICIES, type EmbedUnit, type GroupPolicy } from "./embed-units.ts";
import { buildEmbedText, contentHash } from "./embed-text.ts";

export interface EmbedRow {
  id: string;
  doc_no: string;
  text: string;
  hash: string;
  memberIds: string[];
  attributionOnly: boolean;
  /** The row embeds the document as ITSELF — its title and body — and not a
   *  folded group or a breadcrumbed record. Only such a vector can be compared
   *  with another version of the same document (preview/embeddings-similarity.ts). */
  plain: boolean;
}

/** Atlas order. It decides which rows a capped run embeds first. */
export const byDocNo = (a: { doc_no: string }, b: { doc_no: string }) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true });

/** The shipping grouping policy, or one_to_one when the configured name is unknown. */
export function shippedPolicy(): GroupPolicy {
  return (GROUP_POLICIES as readonly string[]).includes(config.embedGroupPolicy)
    ? (config.embedGroupPolicy as GroupPolicy)
    : "one_to_one";
}

export function planEmbedRows(docs: AtlasNode[], policy: GroupPolicy): { rows: EmbedRow[]; units: EmbedUnit[] } {
  const byId = new Map(docs.map((d) => [d.id, d]));
  // No opts: cap and crumb depth/root were env knobs that measured as no-ops and
  // were removed. Policies carry their own defaults (kv_records_breadcrumbs keeps the
  // root crumb internally because that one IS load-bearing — without it 13 units come
  // out byte-identical to another, i.e. duplicate vectors nothing can rank apart).
  const units = buildUnits(docs, policy, {});
  const folded = [...foldedIds(units)];
  // Folded members used to be DELETED. They are now embedded 1:1 and stored with
  // attribution_only = true (migration 023): excluded from search, read only to decide
  // WHICH member of an already-retrieved group a query wanted. That step was measured
  // at 34% accurate with term overlap vs ~51% against vectors, and is the single
  // largest loss in the pipeline — retrieval finds the right group for essentially
  // every ICD query and attribution throws two thirds of them away.
  const foldedSet = new Set(folded);
  const attributionUnits: EmbedRow[] = folded
    .map((id) => byId.get(id))
    .filter((d): d is NonNullable<typeof d> => !!d)
    .map((d) => ({
      id: d.id,
      doc_no: d.doc_no,
      text: buildEmbedText(d),
      hash: contentHash(d),
      memberIds: [d.id],
      attributionOnly: true,
      plain: true,
    }));

  // Folded members keep contentHash(d) — the same 1:1 hash they had before
  // grouping — so a policy switch (one_to_one → icd_params) is invisible to a
  // hash-only stale check. Those rows still need attribution_only / member_ids
  // written or they keep competing in search.ts's WHERE NOT attribution_only.
  const rows: EmbedRow[] = units
    .map((u) => {
      const anchor = byId.get(u.anchorId);
      return {
        id: u.anchorId,
        doc_no: anchor?.doc_no ?? "",
        text: u.text,
        hash: u.hash,
        memberIds: u.memberIds,
        attributionOnly: foldedSet.has(u.anchorId),
        plain: !!anchor && u.text === buildEmbedText(anchor),
      };
    })
    .concat(attributionUnits);
  return { rows, units };
}
