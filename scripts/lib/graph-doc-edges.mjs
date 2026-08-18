/**
 * Phase 2 doc-structure edges (2a–2h) extraction for build-graph.
 *
 * Emits parent_of, annotates, active_data_for, cites, implements,
 * instance_of + invoked_by, located_at, and has_status edges.
 */

import {
  isAnnotation,
  isActiveData,
  UUID_LINK_RE,
  isICDLocation,
  isICD,
  isGlobalActivationStatus,
  ancestorByStripping,
  primitiveRootFor,
  UUID_SRC,
} from "./graph-patterns.mjs";
import { buildKnownPrimitives, classifyIcd } from "./graph-instances.mjs";

export function extractDocEdges(allDocs, docById, docByDocNo, entityByDocId) {
  const edges = [];
  const docIds = new Set(allDocs.map((d) => d.id));

  function addEdge(fromId, fromType, toId, toType, edgeType, sourceDocNos = [], meta = null) {
    edges.push({ fromId, fromType, toId, toType, edgeType, sourceDocNos, meta });
  }

  // --- 2a. parent_of (from parentId) ---
  for (const d of allDocs) {
    if (d.parentId && docById.has(d.parentId)) {
      addEdge(d.parentId, "doc", d.id, "doc", "parent_of", []);
    }
  }

  // --- 2b. annotates (*.0.3.X, *.0.4.X, *.varX) ---
  for (const d of allDocs.filter(isAnnotation)) {
    if (d.parentId) addEdge(d.id, "doc", d.parentId, "doc", "annotates", [d.doc_no]);
  }

  // --- 2c. active_data_for (*.0.6.X → containing ADC) ---
  // The AD section's doc-tree parent may be several levels above the ADC because
  // build-index caps heading depth at 6. Resolve the ADC by stripping the trailing
  // `.0.6.N` segments from the AD section's doc_no instead.
  for (const d of allDocs.filter(isActiveData)) {
    const adc = ancestorByStripping(d, 3, docByDocNo);
    if (adc) addEdge(d.id, "doc", adc.id, "doc", "active_data_for", [d.doc_no]);
  }

  // --- 2d. cites (UUID markdown links) ---
  let citeCount = 0;
  const citedByDoc = new Map();
  for (const d of allDocs) {
    const seen = citedByDoc.get(d.id) ?? new Set();
    for (const m of (d.content ?? "").matchAll(UUID_LINK_RE)) {
      const targetId = m[2];
      if (docIds.has(targetId) && targetId !== d.id && !seen.has(targetId)) {
        seen.add(targetId);
        addEdge(d.id, "doc", targetId, "doc", "cites", [d.doc_no]);
        citeCount++;
      }
    }
    citedByDoc.set(d.id, seen);
  }
  console.log(`  ${citeCount} cites edges`);

  // --- 2e. implements (primitive root → global primitive in A.2.2) ---
  // Same link shape as UUID_LINK_RE but anchored on the literal "See " lead-in
  // and non-global (only the first citation counts), so it composes the shared
  // UUID source rather than reusing the compiled regex.
  const IMPLEMENTS_RE = new RegExp(String.raw`\bSee\s+\[([^\]]+)\]\((${UUID_SRC})\)`, "i");
  for (const d of allDocs) {
    // fragile: doc_no prefix — the Prime Agent artifacts root (A.6.1.1)
    if (!d.doc_no.startsWith("A.6.1.1.")) continue;
    const m = (d.content ?? "").match(IMPLEMENTS_RE);
    if (!m) continue;
    const targetDoc = docById.get(m[2]);
    // fragile: doc_no prefix — the global Primitives section (A.2.2)
    if (targetDoc && targetDoc.doc_no.startsWith("A.2.2.")) {
      addEdge(d.id, "doc", targetDoc.id, "doc", "implements", [d.doc_no]);
    }
  }

  // --- 2f. instance_of / invocation_of (ICD → primitive root). The atlas
  // distinguishes operational Instances (Active/Suspended/Completed) from
  // in-progress Invocations (InProgress); we emit distinct edge types so
  // consumers can filter without inspecting meta. Meta still carries the status
  // for in-scope primitives. Out-of-scope ICDs default to instance_of with no
  // status. Also emit entity→entity `invoked_by` from the Instance/Invocation
  // to its Prime Agent so they surface clustered around their agent. ---
  const knownPrimitives = buildKnownPrimitives(docById);
  // fragile: doc_no prefix — the Prime Agent artifacts root (A.6.1.1)
  for (const d of allDocs.filter((d) => isICD(d) && d.doc_no.startsWith("A.6.1.1."))) {
    const primRoot = primitiveRootFor(d, docByDocNo);
    if (!primRoot) continue;
    const { kind, status } = classifyIcd(d, primRoot, docByDocNo);
    const isUnknownPrimitive = !knownPrimitives.has(primRoot.title);
    const metaObj = {
      ...(status ? { status } : {}),
      ...(isUnknownPrimitive ? { is_unknown_primitive: true } : {}),
    };
    const meta = Object.keys(metaObj).length > 0 ? JSON.stringify(metaObj) : null;
    const edgeType = kind === "invocation" ? "invocation_of" : "instance_of";
    addEdge(d.id, "doc", primRoot.id, "doc", edgeType, [d.doc_no], meta);

    const agentDocNo = d.doc_no.match(/^(A\.6\.1\.1\.\d+)(?:\.|$)/)?.[1];
    const agentDoc = agentDocNo ? docByDocNo.get(agentDocNo) : null;
    const primeEntity = agentDoc ? entityByDocId.get(agentDoc.id) : null;
    if (primeEntity) {
      addEdge(d.id, "entity", primeEntity.id, "entity", "invoked_by", [d.doc_no], meta);
    }
  }

  // --- 2g. located_at (ICD Location → ICD) ---
  for (const d of allDocs.filter(isICDLocation)) {
    for (const m of (d.content ?? "").matchAll(UUID_LINK_RE)) {
      const targetDoc = docById.get(m[2]);
      if (targetDoc && isICD(targetDoc)) {
        addEdge(d.id, "doc", targetDoc.id, "doc", "located_at", [d.doc_no]);
        break;
      }
    }
  }

  // --- 2h. has_status (primitive root → Global Activation Status) ---
  for (const d of allDocs.filter(
    // fragile: doc_no prefix — the Prime Agent artifacts root (A.6.1.1)
    (d) => isGlobalActivationStatus(d) && d.doc_no.startsWith("A.6.1.1."),
  )) {
    const primRoot = ancestorByStripping(d, 2, docByDocNo);
    if (primRoot) addEdge(primRoot.id, "doc", d.id, "doc", "has_status", [primRoot.doc_no]);
  }

  return edges;
}
