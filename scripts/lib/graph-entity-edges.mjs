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
import { DUTY_ROLES, findRoleDuties } from "./graph-duties.mjs";
import { normalizeAddress } from "./address-chains.mjs";

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
  // Unique operational role-holders — fallback for docs that declare a role
  // without a Prime Agent context (e.g. Support Scope primitives). Only valid
  // when exactly ONE org holds the role atlas-wide: true for Operational GovOps
  // (Soter Labs) today, false for Operational Facilitators (Endgame Edge +
  // Redline Facilitation Group) and Operational Executor Agents (Amatsu +
  // Ozone) — those stay unresolved rather than guessed.
  const uniqueOpGovIds = [...new Set(opGovByExec.values())];
  const uniqueOpGovId = uniqueOpGovIds.length === 1 ? uniqueOpGovIds[0] : null;
  const uniqueOpFacIds = [...new Set(opFacByExec.values())];
  const uniqueOpFacId = uniqueOpFacIds.length === 1 ? uniqueOpFacIds[0] : null;
  const uniqueOpExecIds = [...new Set(opExecByPrime.values())];
  const uniqueOpExecId = uniqueOpExecIds.length === 1 ? uniqueOpExecIds[0] : null;
  // The core executor has no executor edge of its own today — it is the target
  // of the core_govops_for edge.
  const coreExecId = edges.find((e) => e.edgeType === "core_govops_for")?.toId ?? null;

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
      // fragile: doc_no prefix (extracts the agent-artifact index, not just a
      // boolean scope check — a UUID-ancestor migration would need to carry
      // the index through separately, so this stays annotated-only)
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
        else if (role === "operational_facilitator" && uniqueOpFacId)
          entity = entityById.get(uniqueOpFacId);
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

  // --- 2s-ter. duty_for (acting-role duty discovery) ---
  // Neither GovOps nor the Executor Agent has a dedicated "Duties" scope the way
  // Facilitators do (A.1.7) — duties are scattered across primitive, process,
  // and agent-artifact docs. Scan every doc for each acting role (GovOps /
  // Facilitator / Executor Agent — see graph-duties.mjs for the pattern
  // taxonomy) and emit one duty_for edge per (doc, role), resolved to the org
  // entity holding the role. Shared skips:
  //   - Preamble (A.0.*): role definitions, not duties.       // fragile: doc_no prefix
  //   - Role-assignment docs (the source docs of the gov/fac/exec role edges):
  //     they name the role-holder, they impose no duty.
  //   - ADCs: governance-level RP is responsible_party_for (2s).
  //   - Type Specifications (A.1.2.2.*): they define document types and name
  //     roles pervasively ("The Facilitator Action Tenet Type") but task no one.
  //   - Process-step RP docs (2s-bis targets): the structural edge wins over a
  //     fuzzy content match.
  const ROLE_ASSIGNMENT_EDGE_TYPES = new Set([
    "operational_govops_for",
    "core_govops_for",
    "operational_facilitator_for",
    "core_facilitator_for",
    "operational_executor_agent_for",
    "core_executor_agent_for",
  ]);
  const roleAssignmentDocIds = new Set();
  for (const e of edges) {
    if (!ROLE_ASSIGNMENT_EDGE_TYPES.has(e.edgeType)) continue;
    const d = e.sourceDocNos?.[0] ? docByDocNo.get(e.sourceDocNos[0]) : null;
    if (d) roleAssignmentDocIds.add(d.id);
  }

  // Per-role: org list for name-attributed duties, and a resolver from a
  // declared role label (+ doc context) to the holding entity. Operational
  // roles resolve via the doc's agent-artifact chain, then the unique-holder
  // fallback (null when several orgs hold the role — counted, never guessed).
  const artifactExecId = (d) => {
    // fragile: doc_no prefix (extracts the agent-artifact index; kept
    // annotated-only for the same reason as the other artifactExecId-shaped
    // match above)
    const m = d.doc_no.match(/^A\.6\.1\.1\.(\d+)\./);
    if (!m) return null;
    const primeEntity = entityByDocId.get(docByDocNo.get(`A.6.1.1.${m[1]}`)?.id);
    return primeEntity ? (opExecByPrime.get(primeEntity.id) ?? null) : null;
  };
  const dutyRoleContext = {
    govops: {
      coreId: coreGovId,
      opByExec: opGovByExec,
      uniqueOpId: uniqueOpGovId,
      opIds: uniqueOpGovIds,
    },
    facilitator: {
      coreId: coreFacId,
      opByExec: opFacByExec,
      uniqueOpId: uniqueOpFacId,
      opIds: uniqueOpFacIds,
    },
    executor: {
      coreId: coreExecId,
      opByExec: null, // the chain target IS the executor
      uniqueOpId: uniqueOpExecId,
      opIds: uniqueOpExecIds,
    },
  };
  const orgIdByName = new Map();
  const orgsByRole = new Map();
  for (const role of DUTY_ROLES) {
    const ctx = dutyRoleContext[role.key];
    const orgs = [];
    for (const id of ctx.opIds) {
      const e = entityById.get(id);
      if (e) {
        orgs.push({ name: e.name, role_declared: role.op.label });
        orgIdByName.set(e.name, e.id);
      }
    }
    const coreEntity = entityById.get(ctx.coreId);
    if (coreEntity) {
      orgs.push({ name: coreEntity.name, role_declared: role.core.label });
      orgIdByName.set(coreEntity.name, coreEntity.id);
    }
    orgsByRole.set(role.key, orgs);
  }
  // A duty that cannot be pinned to ONE holder binds EVERY holder — "Operational
  // Facilitator must X" outside an agent-artifact context is a duty of both
  // operational facilitator orgs in their own contexts, and a bare-label duty
  // ("Facilitators must document…", A.1.6 universal duties) binds the core org
  // too. Fan out one edge per holder rather than dropping the duty.
  const resolveDutyEntities = (role, d, duty) => {
    const ctx = dutyRoleContext[role.key];
    const byIds = (ids) => ids.map((id) => entityById.get(id)).filter(Boolean);
    if (duty.orgName) return byIds([orgIdByName.get(duty.orgName)]);
    if (duty.role_declared === role.core.label) return byIds([ctx.coreId]);
    const execId = artifactExecId(d);
    if (execId) return byIds([ctx.opByExec ? ctx.opByExec.get(execId) : execId]);
    if (duty.role_declared === role.op.label) return byIds(ctx.opIds);
    return byIds([...ctx.opIds, ctx.coreId]); // bare label — universal duty
  };

  const dutyStats = new Map(DUTY_ROLES.map((r) => [r.key, { edges: 0, unresolved: 0, byMatch: new Map() }]));
  for (const d of allDocs) {
    if (d.doc_no.startsWith("A.0.")) continue;
    if (roleAssignmentDocIds.has(d.id)) continue;
    if (d.type === "Active Data Controller") continue;
    if (d.type === "Type Specification") continue;
    // Narrative/research doc types are never themselves an operative duty —
    // Scenarios/Scenario Variations illustrate a misalignment finding,
    // Annotations define a rubric element, Needed Research poses an open
    // question. Same exclusion riskRules.ts applies for risk-rule candidacy.
    if (d.type === "Scenario" || d.type === "Scenario Variation") continue;
    if (d.type === "Annotation") continue;
    if (d.type === "Needed Research") continue;
    if (stepRpTargetIds.has(d.id)) continue;
    for (const role of DUTY_ROLES) {
      const duties = findRoleDuties(role, d.title, d.content, orgsByRole.get(role.key));
      const stats = dutyStats.get(role.key);
      for (const duty of duties) {
        const entities = resolveDutyEntities(role, d, duty);
        if (!entities.length) {
          stats.unresolved++;
          continue;
        }
        for (const entity of entities) {
          addEdge(
            entity.id,
            "entity",
            d.id,
            "doc",
            "duty_for",
            [d.doc_no],
            JSON.stringify({ role_declared: duty.role_declared, match: duty.match, quote: duty.quote }),
          );
          stats.edges++;
        }
        stats.byMatch.set(duty.match, (stats.byMatch.get(duty.match) ?? 0) + 1);
      }
    }
  }
  for (const role of DUTY_ROLES) {
    const s = dutyStats.get(role.key);
    console.log(
      `  duty_for[${role.key}]: ${s.edges} edges (${["title", "active", "passive", "phrase", "org"]
        .map((k) => `${s.byMatch.get(k) ?? 0} ${k}`)
        .join(", ")}), ${s.unresolved} unresolved`,
    );
  }

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
      // normalizeAddress = EVM→lowercase, Solana base58 left as-is. addressRefs
      // carry raw casing; addressesRaw is keyed by the normalized form, and the
      // node id MUST match the has_address side or the graph splits around Solana.
      const key = normalizeAddress(addr);
      const info = addressesRaw[key];
      const chain = info?.chain ?? "ethereum";
      addEdge(d.id, "doc", `${key}:${chain}`, "address", "mentions", [d.doc_no]);
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
        `${normalizeAddress(addr)}:${chain}`,
        "address",
        `${normalizeAddress(info.implementation)}:${chain}`,
        "address",
        "proxies_to",
        [],
      );
    }
  }

  return edges;
}
