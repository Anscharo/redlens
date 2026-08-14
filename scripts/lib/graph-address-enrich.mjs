/**
 * Address enrichment (Phase 4.5) for build-graph.
 *
 * Five passes enrich addressesAtlas in place with graph-derived annotations,
 * each only filling gaps a prior pass left open:
 *   4.5a — ICD-param: roles + entityLabel from structured ICD params
 *   4.5b — Entity-linked: entityLabel from graph entities via labelToAddresses
 *   4.5c — Parent-titled: "Address" docs → parent doc title
 *   4.5d — Doc-titled: any address-bearing doc with a descriptive title
 *   4.5e — Chainlog/Etherscan fallback: last resort from on-chain data
 *
 * Mutates addressesAtlas in place; the caller (build-graph.mjs) owns writing
 * public/addresses.atlas.json and logging the summary. Never touches
 * addresses.json (on-chain data) — see build-graph.mjs header.
 */

import { ancestorByStripping } from "./graph-patterns.mjs";

export function enrichAddresses({
  allDocs,
  docByDocNo,
  addressesAtlas,
  addressesOnChain,
  icdAnnotations,
  entityMap,
  labelToAddresses,
}) {
  let icdUpdated = 0, icdMissing = 0, icdRechained = 0;
  let entityLabeled = 0, parentLabeled = 0, titleLabeled = 0, chainlogFallback = 0;

  // 4.5a
  for (const [addr, ann] of icdAnnotations) {
    const entry = addressesAtlas[addr];
    if (!entry) { icdMissing++; continue; }
    entry.roles = [...new Set([...ann.roles, ...(entry.roles ?? [])])];
    if (ann.entityLabel) entry.entityLabel = ann.entityLabel;
    // A chain the ICD states outright beats build-index's prose/heading
    // heuristic — a `Token Address (Avalanche)` param key or a `Network` param
    // is structured data about this exact address. It becomes the primary and
    // joins `chains` (the address may still be on the others too).
    if (ann.chain) {
      entry.chains = [...new Set([ann.chain, ...(entry.chains ?? [entry.chain])])];
      if (ann.chain !== entry.chain) {
        entry.chain = ann.chain;
        icdRechained++;
      }
    }
    icdUpdated++;
  }

  // 4.5b
  for (const [slug, addrList] of labelToAddresses) {
    const entity = entityMap.get(slug);
    if (!entity) continue;
    for (const { addr } of addrList) {
      const entry = addressesAtlas[addr];
      if (!entry || entry.entityLabel) continue;
      entry.entityLabel = entity.name;
      entityLabeled++;
    }
  }

  // 4.5c
  const GENERIC_TITLE = /^address(?:es)?$/i;
  for (const doc of allDocs) {
    if (!GENERIC_TITLE.test(doc.title.trim()) || !doc.addressRefs?.length) continue;
    // Parent via doc_no arithmetic, not parentId: heading depth caps at 6, and
    // these generic "Address" leaves sit well below that in the artifact trees.
    const parentDoc = ancestorByStripping(doc, 1, docByDocNo);
    if (!parentDoc) continue;
    for (const addr of doc.addressRefs) {
      const entry = addressesAtlas[addr.toLowerCase()] ?? addressesAtlas[addr];
      if (!entry || entry.entityLabel) continue;
      entry.entityLabel = parentDoc.title;
      parentLabeled++;
    }
  }

  // 4.5d
  const SKIP_TITLE_D = /^address(?:es)?$|^parameters?$/i;
  for (const doc of allDocs) {
    if (!doc.addressRefs?.length || SKIP_TITLE_D.test(doc.title.trim())) continue;
    for (const addr of doc.addressRefs) {
      const entry = addressesAtlas[addr.toLowerCase()] ?? addressesAtlas[addr];
      if (!entry || entry.entityLabel) continue;
      entry.entityLabel = doc.title;
      titleLabeled++;
    }
  }

  // 4.5e: chainlog/Etherscan fallback — pull from on-chain file
  for (const [addr, entry] of Object.entries(addressesAtlas)) {
    if (entry.entityLabel) continue;
    const onChain = addressesOnChain[addr] ?? {};
    const fallback = onChain.chainlogId ?? onChain.etherscanName ?? null;
    if (fallback) { entry.entityLabel = fallback; chainlogFallback++; }
  }

  return { icdUpdated, icdMissing, icdRechained, entityLabeled, parentLabeled, titleLabeled, chainlogFallback };
}
