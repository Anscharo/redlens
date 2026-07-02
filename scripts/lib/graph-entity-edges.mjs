/**
 * Phase 2 entity + address edges (2i–2w) extraction for build-graph.
 *
 * Emits all entity-target relationships: prime_agent_for, executor_agent_for,
 * facilitator_for, govops_for, aligned/ranked delegate, holds_role,
 * ecosystem_accord, comprises, erg_member, responsible_party_for,
 * defines_entity, has_address, mentions, proxies_to.
 */

import {
  slugify,
  isPrimeAgent,
  isFacilitatorDoc,
  isGovOpsDoc,
  isEcosystemAccord,
  extractAssignment,
  extractRP,
  extractAllRP,
  extractAutomation,
  rpRoleAndName,
  ALIGNED_DELEGATES_UUID,
} from "./graph-patterns.mjs";
import { findGovOpsDuty } from "./graph-duties.mjs";

export function extractEntityEdges(allDocs, docById, docByDocNo, entityContext, addressesRaw) {
  const {
    entityMap,
    entityByDocId,
    labelToAddresses,
    alignedDelegateNames,
    rankedDelegatesByLevel,
    roleBindings,
    ergDoc,
    ergMemberNames,
    accordPartyDocsByAccordDocNo,
  } = entityContext;

  const edges = [];
  const docIds = new Set(allDocs.map((d) => d.id));

  // Bootstrap entity refs (always present from Phase 1)
  const skyCore = entityMap.get("sky-core");
  const skyGovernance = entityMap.get("sky-governance");
  const supportFacilitators = entityMap.get("support-facilitators");

  const entityById = new Map([...entityMap.values()].map((e) => [e.id, e]));
  const entityByName = (name) => entityMap.get(slugify(name));

  function addEdge(fromId, fromType, toId, toType, edgeType, sourceDocNos = [], meta = null) {
    const edge = { fromId, fromType, toId, toType, edgeType, sourceDocNos, meta };
    edges.push(edge);
    return edge;
  }

  // --- 2i. prime_agent_for: each Prime Agent → Sky Core (Pattern 1) ---
  for (const d of allDocs.filter(isPrimeAgent)) {
    const ent = entityByDocId.get(d.id);
    if (ent) addEdge(ent.id, "entity", skyCore.id, "entity", "prime_agent_for", [d.doc_no]);
  }

  // --- 2j. {operational,core}_executor_agent_for (Pattern 3) ---
  // Source: ICD parameter docs titled "Operational/Core Executor Agent" at
  // A.6.1.1.X.2.Z.2.N.1.1.1. Content cites the executor's defining doc. Walk parentId
  // chain to find the prime agent.
  const UUID_LINK_RE =
    /\[([^\]]*)\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
  for (const paramDoc of allDocs.filter((d) =>
    /^(operational|core)(?: council)? executor agent$/i.test(d.title),
  )) {
    let executorDocId = null;
    for (const m of (paramDoc.content ?? "").matchAll(UUID_LINK_RE)) {
      if (docIds.has(m[2])) {
        executorDocId = m[2];
        break;
      }
    }
    if (!executorDocId) continue;
    const executorEntity = entityByDocId.get(executorDocId);
    if (!executorEntity) continue;

    let cur = paramDoc;
    let primeDoc = null;
    for (let i = 0; i < 20 && cur?.parentId; i++) {
      const parent = docById.get(cur.parentId);
      if (parent && isPrimeAgent(parent)) {
        primeDoc = parent;
        break;
      }
      cur = parent;
    }
    if (!primeDoc) continue;
    const primeEntity = entityByDocId.get(primeDoc.id);
    if (!primeEntity) continue;

    // Best-effort matching accord doc (by party name containing the executor name).
    const primeName = primeEntity.name;
    const accordDoc = allDocs.find((a) => {
      if (!isEcosystemAccord(a)) return false;
      const partyDocs = accordPartyDocsByAccordDocNo.get(a.doc_no) ?? [];
      return partyDocs.some(
        (pd) => pd.partyEntity.id === primeEntity.id || (pd.memberStr ?? "").includes(primeName),
      );
    });
    const sources = [paramDoc.doc_no];
    if (accordDoc) sources.push(accordDoc.doc_no);

    const edgeType =
      executorEntity.subtype === "core_executor"
        ? "core_executor_agent_for"
        : "operational_executor_agent_for";
    addEdge(executorEntity.id, "entity", primeEntity.id, "entity", edgeType, sources);
  }

  // --- 2k. {operational,core}_facilitator_for (Pattern 5) ---
  for (const d of allDocs.filter(isFacilitatorDoc)) {
    const isCore = /core executor facilitator/i.test(d.title);
    const name = extractAssignment(
      d.content,
      "(?:The )?(?:(?:Operational|Core) (?:Executor )?)?Facilitator for [^.]+",
    );
    if (!name) continue;
    const facEntity = entityByName(name);
    const executorDoc = d.parentId ? docById.get(d.parentId) : null;
    const executorEntity = executorDoc ? entityByDocId.get(executorDoc.id) : null;
    if (!facEntity || !executorEntity) continue;
    const edgeType = isCore ? "core_facilitator_for" : "operational_facilitator_for";
    addEdge(facEntity.id, "entity", executorEntity.id, "entity", edgeType, [d.doc_no]);
  }

  // --- 2l. {operational,core}_govops_for (Pattern 5) ---
  for (const d of allDocs.filter(isGovOpsDoc)) {
    const isCore = /core govops/i.test(d.title);
    const name = extractAssignment(d.content, "(?:(?:Operational|Core) )?GovOps for [^.]+");
    if (!name) continue;
    const govEntity = entityByName(name);
    const executorDoc = d.parentId ? docById.get(d.parentId) : null;
    const executorEntity = executorDoc ? entityByDocId.get(executorDoc.id) : null;
    if (!govEntity || !executorEntity) continue;
    const edgeType = isCore ? "core_govops_for" : "operational_govops_for";
    addEdge(govEntity.id, "entity", executorEntity.id, "entity", edgeType, [d.doc_no]);
  }

  // --- 2m. aligned_delegate_for (Pattern 10) ---
  // Fallback path for a list/prose-shaped registry. The doc is a table today,
  // so alignedDelegateNames is usually empty and the edges are emitted from
  // the table rows in build-graph Phase 2.7 instead.
  const alignedDelegatesDoc = docById.get(ALIGNED_DELEGATES_UUID);
  for (const name of alignedDelegateNames) {
    const entity = entityByName(name);
    if (entity && alignedDelegatesDoc) {
      addEdge(entity.id, "entity", skyGovernance.id, "entity", "aligned_delegate_for", [
        alignedDelegatesDoc.doc_no,
      ]);
    }
  }

  // --- 2n. ranked_delegate_for (Pattern 10; meta.level) ---
  for (const [level, items] of rankedDelegatesByLevel) {
    for (const { name, docNo } of items) {
      const entity = entityByName(name);
      if (entity) {
        addEdge(
          entity.id,
          "entity",
          skyGovernance.id,
          "entity",
          "ranked_delegate_for",
          [docNo],
          JSON.stringify({ level }),
        );
      }
    }
  }

  // --- 2o. holds_role_for (Pattern 11) ---
  for (const { holder, bindingDoc, roleSlug } of roleBindings) {
    addEdge(
      holder.id,
      "entity",
      bindingDoc.id,
      "doc",
      "holds_role_for",
      [bindingDoc.doc_no],
      JSON.stringify({ role: roleSlug }),
    );
  }

  // --- 2p. ecosystem_accord: accord doc → party entity (composite_party or Sky Core) ---
  // Target is the composite party, not individual members. Built from Pattern 12's party-details scan.
  for (const [accordDocNo, partyDocs] of accordPartyDocsByAccordDocNo) {
    const accordDoc = docByDocNo.get(accordDocNo);
    if (!accordDoc) continue;
    for (const { partyEntity } of partyDocs) {
      addEdge(accordDoc.id, "doc", partyEntity.id, "entity", "ecosystem_accord", [accordDocNo]);
    }
  }

  // --- 2q. comprises: composite_party → member (Pattern 12) ---
  // Skip the "Sky" party (maps to Sky Core bootstrap; no composite created, no comprises edge emitted).
  // Inline parseNameList & resolveAccordMember-style resolution since we don't
  // need new entities here — every member was already created in Phase 1.
  const parseNameList = (str) =>
    str
      .split(/,\s*/)
      .flatMap((p) => p.split(/\s+and\s+/i))
      .map((s) =>
        s
          .trim()
          .replace(/^(?:the|and)\s+/i, "")
          .trim(),
      )
      .filter(Boolean);

  function resolveMember(rawName) {
    const cleaned = rawName.replace(/^the\s+/i, "").trim();
    if (/^Sky Core$/i.test(cleaned)) return skyCore;
    const stripped = cleaned.replace(/\s+(Prime Agent|Executor Agent)$/i, "").trim();
    if (stripped !== cleaned) {
      const hit = entityMap.get(slugify(stripped));
      if (hit) return hit;
    }
    return entityMap.get(slugify(cleaned)) ?? null;
  }

  // One comprises edge per (party, member) pair, but every accord that
  // re-states the party is appended to source_doc_nos — accord 10 restating
  // "Grove comprises …" is provenance, not a duplicate to drop.
  const emittedComprises = new Map(); // key → edge
  for (const [, partyDocs] of accordPartyDocsByAccordDocNo) {
    for (const { partyEntity, sourceDocNo, memberStr, isSky } of partyDocs) {
      if (isSky) continue;
      for (const memberName of parseNameList(memberStr)) {
        const memberEntity = resolveMember(memberName);
        if (memberEntity && memberEntity.id !== partyEntity.id) {
          const key = `${partyEntity.id}:${memberEntity.id}`;
          const prior = emittedComprises.get(key);
          if (prior) {
            if (!prior.sourceDocNos.includes(sourceDocNo)) prior.sourceDocNos.push(sourceDocNo);
          } else {
            emittedComprises.set(
              key,
              addEdge(partyEntity.id, "entity", memberEntity.id, "entity", "comprises", [sourceDocNo]),
            );
          }
        }
      }
    }
  }

  // --- 2r. erg_member_for (Pattern 7) ---
  if (ergDoc) {
    for (const name of ergMemberNames) {
      const entity = entityByName(name);
      if (entity) addEdge(entity.id, "entity", ergDoc.id, "doc", "erg_member_for", [ergDoc.doc_no]);
    }
  }

  // --- 2s. responsible_party_for (Pattern 6) ---
  // Every Active Data Controller declares a Responsible Party (Atlas A.1.12.1.2).
  // Resolution priority:
  //   direct — declaration names an existing entity (e.g. "…is Soter Labs.")
  //   chain  — declaration names a role; walk Prime Agent → Executor Agent → role edge
  //   role   — declaration names a role-binding doc's title (holds_role_for edge)
  // Edges carry meta.role_declared (raw declaration) and meta.resolution.
  const opExecByPrime = new Map();
  const opFacByExec = new Map();
  const opGovByExec = new Map();
  const roleHolderByDocTitle = new Map(); // normalized title → source entity id
  for (const e of edges) {
    if (e.edgeType === "operational_executor_agent_for") opExecByPrime.set(e.toId, e.fromId);
    else if (e.edgeType === "operational_facilitator_for") opFacByExec.set(e.toId, e.fromId);
    else if (e.edgeType === "operational_govops_for") opGovByExec.set(e.toId, e.fromId);
    else if (e.edgeType === "holds_role_for") {
      const targetDoc = docById.get(e.toId);
      if (targetDoc?.title) roleHolderByDocTitle.set(targetDoc.title.toLowerCase(), e.fromId);
    }
  }
  // Core Facilitator / GovOps resolve to a single entity across the atlas.
  const coreFacId = edges.find((e) => e.edgeType === "core_facilitator_for")?.fromId ?? null;
  const coreGovId = edges.find((e) => e.edgeType === "core_govops_for")?.fromId ?? null;
  // Unique operational_govops entity — fallback for A.2.* ADCs that declare
  // "Operational GovOps" without a Prime Agent context (e.g. Support Scope primitives).
  const uniqueOpGovIds = [...new Set(opGovByExec.values())];
  const uniqueOpGovId = uniqueOpGovIds.length === 1 ? uniqueOpGovIds[0] : null;

  // Resolve a raw "Responsible Party" declaration to its entity, given the doc it
  // was declared on (for Prime-Agent-context chain resolution). Shared by 2s (ADC
  // governance-level RP) and 2s-bis (process-step execution RP, below) — same
  // declaration shapes, same resolution priority.
  function resolveResponsibleParty(d, raw) {
    const { role, name } = rpRoleAndName(raw);
    let entity = null;
    let resolution = null;

    // Role-binding resolution (Pattern 11): declaration names a role doc's title.
    // e.g. "Core Council Risk Advisor" → A.1.7.1.1.2 title → BA Labs.
    // First priority — overrides accidental stub entities created in 1f/1g.
    if (name) {
      const needle = name.toLowerCase();
      for (const [title, holderId] of roleHolderByDocTitle) {
        if (title === needle || title.includes(needle)) {
          entity = entityById.get(holderId);
          if (entity) {
            resolution = "role";
            break;
          }
        }
      }
    }

    if (!entity && name) {
      entity = entityByName(name);
      if (entity) resolution = "direct";
    }

    if (!entity && role) {
      const m = d.doc_no.match(/^A\.6\.1\.1\.(\d+)\./);
      if (m) {
        const primeEntity = entityByDocId.get(docByDocNo.get(`A.6.1.1.${m[1]}`)?.id);
        const execId = primeEntity ? opExecByPrime.get(primeEntity.id) : null;
        if (role === "operational_govops" && execId)
          entity = entityById.get(opGovByExec.get(execId));
        else if (role === "operational_facilitator" && execId)
          entity = entityById.get(opFacByExec.get(execId));
        else if (role === "core_facilitator") entity = entityById.get(coreFacId);
        else if (role === "core_govops") entity = entityById.get(coreGovId);
      } else {
        if (role === "core_facilitator") entity = entityById.get(coreFacId);
        else if (role === "core_govops") entity = entityById.get(coreGovId);
        else if (role === "operational_govops" && uniqueOpGovId)
          entity = entityById.get(uniqueOpGovId);
        else if (role === "support_facilitators") entity = supportFacilitators;
      }
      if (entity) resolution = "chain";
    }

    return { entity, resolution, role };
  }

  let rpDirect = 0,
    rpChain = 0,
    rpRole = 0,
    rpUnresolved = 0;
  for (const d of allDocs.filter((d) => d.type === "Active Data Controller")) {
    const raw = extractRP(d.content);
    if (!raw) {
      rpUnresolved++;
      continue;
    }
    const { entity, resolution } = resolveResponsibleParty(d, raw);

    if (entity) {
      addEdge(
        entity.id,
        "entity",
        d.id,
        "doc",
        "responsible_party_for",
        [d.doc_no],
        JSON.stringify({ role_declared: raw, resolution }),
      );
      if (resolution === "direct") rpDirect++;
      else if (resolution === "chain") rpChain++;
      else rpRole++;
    } else {
      rpUnresolved++;
    }
  }
  console.log(
    `  responsible_party_for: ${rpDirect} direct, ${rpChain} via chain, ${rpRole} via role-binding, ${rpUnresolved} unresolved`,
  );

  // --- 2s-bis. process_step_responsible_party_for (Pattern 6, process-step) ---
  // Process-step "Update" docs (type=Core, mostly A.2.2.9.*) carry the same
  // bulleted "Responsible Party:" field as ADCs, but for PER-STEP EXECUTION, not
  // governance data-ownership — a distinct edge type so it never conflates with
  // responsible_party_for (Pattern 6 / A.1.12.1.2). Scoped to non-ADC docs to
  // avoid duplicating 2s. A doc may carry several steps; dedupe per (doc,
  // resolved entity, declared role) — same role repeated collapses to one edge,
  // but a doc with both an Operational and a Core declaration keeps both even if
  // they happen to resolve to the same entity.
  let stepRpEdges = 0,
    stepRpDocs = 0,
    stepRpUnresolved = 0;
  const stepRpTargetIds = new Set(); // consumed by 2s-ter — structural RP beats fuzzy duty scan
  for (const d of allDocs.filter((d) => d.type !== "Active Data Controller")) {
    const declarations = extractAllRP(d.content);
    if (!declarations.length) continue;
    stepRpDocs++;
    const emitted = new Set();
    for (const raw of declarations) {
      const { clean, automated } = extractAutomation(raw);
      const { entity, resolution, role } = resolveResponsibleParty(d, clean);
      if (!entity) {
        stepRpUnresolved++;
        continue;
      }
      const key = `${entity.id}:${role ?? ""}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      addEdge(
        entity.id,
        "entity",
        d.id,
        "doc",
        "process_step_responsible_party_for",
        [d.doc_no],
        JSON.stringify({ role_declared: raw, resolution, automated }),
      );
      stepRpTargetIds.add(d.id);
      stepRpEdges++;
    }
  }
  console.log(
    `  process_step_responsible_party_for: ${stepRpEdges} edges across ${stepRpDocs} docs, ${stepRpUnresolved} unresolved`,
  );

  // --- 2s-ter. duty_for (GovOps duty discovery) ---
  // GovOps has no dedicated "Duties" scope the way Facilitators do (A.1.7) — its
  // duties are scattered across primitive, process, and agent-artifact docs. Scan
  // every doc for GovOps as an obligated/empowered subject (see graph-duties.mjs
  // for the pattern taxonomy) and emit one duty_for edge per doc, resolved to the
  // GovOps org entity. Skips, mirroring the report's semantics:
  //   - Preamble (A.0.*): role definitions, not duties.       // fragile: doc_no prefix
  //   - Assignment docs (A.6.1.2.<n>.2): covered by the        // fragile: doc_no prefix
  //     {operational,core}_govops_for edges.
  //   - ADCs: governance-level RP is responsible_party_for (2s).
  //   - Process-step RP docs (2s-bis targets): the structural edge wins over a
  //     fuzzy content match.
  const ASSIGNMENT_DOCNO_RE = /^A\.6\.1\.2\.\d+\.2$/;
  const govOrgs = [];
  const govOrgIdByName = new Map();
  for (const id of uniqueOpGovIds) {
    const e = entityById.get(id);
    if (e) {
      govOrgs.push({ name: e.name, role_declared: "Operational GovOps" });
      govOrgIdByName.set(e.name, e.id);
    }
  }
  const coreGovEntity = entityById.get(coreGovId);
  if (coreGovEntity) {
    govOrgs.push({ name: coreGovEntity.name, role_declared: "Core GovOps" });
    govOrgIdByName.set(coreGovEntity.name, coreGovEntity.id);
  }

  let dutyEdges = 0,
    dutyUnresolved = 0;
  const dutyByMatch = new Map();
  for (const d of allDocs) {
    if (d.doc_no.startsWith("A.0.")) continue;
    if (ASSIGNMENT_DOCNO_RE.test(d.doc_no)) continue;
    if (d.type === "Active Data Controller") continue;
    if (stepRpTargetIds.has(d.id)) continue;
    const duty = findGovOpsDuty(d.title, d.content, govOrgs);
    if (!duty) continue;
    const entity = duty.orgName
      ? entityById.get(govOrgIdByName.get(duty.orgName))
      : duty.role_declared === "Core GovOps"
        ? entityById.get(coreGovId)
        : entityById.get(uniqueOpGovId);
    if (!entity) {
      dutyUnresolved++;
      continue;
    }
    addEdge(
      entity.id,
      "entity",
      d.id,
      "doc",
      "duty_for",
      [d.doc_no],
      JSON.stringify({ role_declared: duty.role_declared, match: duty.match, quote: duty.quote }),
    );
    dutyEdges++;
    dutyByMatch.set(duty.match, (dutyByMatch.get(duty.match) ?? 0) + 1);
  }
  console.log(
    `  duty_for: ${dutyEdges} edges (${["title", "active", "passive", "phrase", "org"]
      .map((k) => `${dutyByMatch.get(k) ?? 0} ${k}`)
      .join(", ")}), ${dutyUnresolved} unresolved`,
  );

  // --- 2t. defines_entity (doc → entity it defines) ---
  for (const e of entityMap.values()) {
    if (e.defining_doc_id && docIds.has(e.defining_doc_id)) {
      addEdge(e.defining_doc_id, "doc", e.id, "entity", "defines_entity", []);
    }
  }

  // --- 2u. has_address (entity → address) ---
  for (const [s, entity] of entityMap) {
    for (const { addr, chain } of labelToAddresses.get(s) ?? []) {
      addEdge(entity.id, "entity", `${addr}:${chain}`, "address", "has_address", []);
    }
  }

  // --- 2v. mentions (doc → address) ---
  for (const d of allDocs) {
    for (const addr of d.addressRefs ?? []) {
      const info = addressesRaw[addr] ?? addressesRaw[addr.toLowerCase()];
      const chain = info?.chain ?? "ethereum";
      addEdge(d.id, "doc", `${addr.toLowerCase()}:${chain}`, "address", "mentions", [d.doc_no]);
    }
  }

  // --- 2x. Org-to-org prose relations ---
  // Two conservative sentence shapes; an edge is emitted only when BOTH
  // endpoints resolve to existing entities (unresolved matches are logged,
  // never guessed — these are long-tail color, recall is deliberately low).
  //   "Rubicon is the Prime Foundation associated with Obex."  → prime_foundation_of
  //   "Phoenix Labs is a development company that provides services to the
  //    Spark Foundation"                                       → provides_services_to
  const PRIME_FOUNDATION_RE =
    /\b([A-Z][A-Za-z0-9'&. -]+?) is the Prime Foundation associated with (?:the )?([A-Z][A-Za-z0-9'&. -]+?)[.,]/g;
  const PROVIDES_SERVICES_RE =
    /\b([A-Z][A-Za-z0-9'&. -]+?) is an? [a-z -]*company that provides services to (?:the )?([A-Z][A-Za-z0-9'&. -]+?)[.,]/g;
  {
    let emitted = 0,
      skipped = 0;
    const seen = new Set();
    for (const d of allDocs) {
      const content = d.content ?? "";
      for (const [re, edgeType] of [
        [PRIME_FOUNDATION_RE, "prime_foundation_of"],
        [PROVIDES_SERVICES_RE, "provides_services_to"],
      ]) {
        re.lastIndex = 0;
        for (const m of content.matchAll(re)) {
          const fromName = m[1].trim().replace(/^the\s+/i, "");
          const toName = m[2].trim().replace(/^the\s+/i, "");
          const from = entityByName(fromName);
          const to = entityByName(toName);
          if (!from || !to || from.id === to.id) {
            skipped++;
            console.warn(`  org-prose: unresolved ${edgeType} "${fromName}" → "${toName}" (${d.doc_no})`);
            continue;
          }
          const key = `${edgeType}:${from.id}:${to.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          addEdge(from.id, "entity", to.id, "entity", edgeType, [d.doc_no]);
          emitted++;
        }
      }
    }
    console.log(`  org-prose: ${emitted} edges (${skipped} unresolved matches skipped)`);
  }

  // --- 2w. proxies_to (address → implementation address) ---
  for (const [addr, info] of Object.entries(addressesRaw)) {
    if (info.implementation) {
      const chain = info.chain ?? "ethereum";
      addEdge(
        `${addr.toLowerCase()}:${chain}`,
        "address",
        `${info.implementation.toLowerCase()}:${chain}`,
        "address",
        "proxies_to",
        [],
      );
    }
  }

  return edges;
}
