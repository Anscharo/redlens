/**
 * Phase 1 of build-graph: entity extraction.
 *
 * Walks all atlas docs and extracts agents, facilitators, govops, delegates,
 * accord parties, primitive instances, and bootstrap entities. Returns a
 * context object consumed by graph-doc-edges and graph-entity-edges.
 */

import {
  slugify,
  makeEntity,
  ERG_MEMBERSHIP_UUID,
  ALIGNED_DELEGATES_UUID,
  RANKED_DELEGATE_UUIDS,
  SPELL_TEAM_UUID,
  ACTIVE_ECOSYSTEM_ACTORS_UUID,
  CCRA_BINDING_UUID,
  isPrimeAgent,
  isExecutorAgent,
  isFacilitatorDoc,
  isGovOpsDoc,
  isGrantDoc,
  isPartyDetails,
  isICD,
  COMPRISES_RE,
  ATOMIC_PARTY_RE,
  extractAssignment,
  extractRP,
  rpRoleAndName,
  parseNameList,
  extractListItems,
  primitiveRootFor,
} from "./graph-patterns.mjs";
import {
  buildKnownPrimitives,
  primitiveSlugFromTitle,
  deriveInstanceName,
  classifyIcd,
  primitiveStatusFor,
  buildChildrenIndex,
  extractInstanceParams,
} from "./graph-instances.mjs";

export function extractEntities(allDocs, docById, docByDocNo, addressesRaw) {
  const entityMap = new Map(); // slug → entity record

  function addEntity(slug, name, entity_type, subtype, defining_doc_id, meta = null) {
    if (entityMap.has(slug)) return entityMap.get(slug);
    const ent = makeEntity(slug, name, entity_type, { subtype, defining_doc_id, meta });
    entityMap.set(slug, ent);
    return ent;
  }

  function entityByName(name) {
    return entityMap.get(slugify(name));
  }

  // --- 1a. Bootstrap entities (Pattern 13) ---
  // Sky Core / Sky Governance — targets of role edges; no defining doc.
  const skyCore = addEntity("sky-core", "Sky Core", "operational_party", null, null, {
    source: "bootstrap",
  });
  addEntity(
    "sky-governance",
    "Sky Governance",
    "governance_body",
    null,
    "18ac7dd3-c646-4352-9b0d-d01a2932d7d1",
    { source: "bootstrap", defining_doc_no: "A.1" },
  );
  // Support Facilitators — role defined at A.2.10.1.1; no named current holder in Atlas.
  addEntity(
    "support-facilitators",
    "Support Facilitators",
    "governance_body",
    null,
    "aeb75fe3-f52b-4cdf-a206-1e54ef648d88",
    { source: "bootstrap", defining_doc_no: "A.2.10.1.1" },
  );

  // --- 1b. Prime Agents (Pattern 1) ---
  for (const d of allDocs.filter(isPrimeAgent)) {
    const s = slugify(d.title);
    const ent = addEntity(s, d.title, "agent", "prime", d.id);
    ent.id = d.id; // use atlas doc uuid as entity id
  }

  // --- 1c. Executor Agents (Pattern 1) ---
  // Strip "Operational Executor Agent " prefix so the semantic short name survives
  // ("Ozone", "Amatsu"). Keep full title for Core Council entries because the number
  // suffix IS their identity ("Core Council Executor Agent 1").
  for (const d of allDocs.filter(isExecutorAgent)) {
    const isCore = /^Core Council Executor Agent/i.test(d.title);
    const name = isCore ? d.title : d.title.replace(/^Operational Executor Agent\s+/i, "").trim();
    const subtype = isCore ? "core_executor" : "operational_executor";
    const ent = addEntity(slugify(name), name, "agent", subtype, d.id);
    ent.id = d.id;
  }

  // --- 1d. Facilitators (Pattern 5) — entity_type = facilitator_org ---
  for (const d of allDocs.filter(isFacilitatorDoc)) {
    const name = extractAssignment(
      d.content,
      "(?:The )?(?:(?:Operational|Core) (?:Executor )?)?Facilitator for [^.]+",
    );
    if (name)
      addEntity(slugify(name), name, "facilitator_org", null, d.id, {
        source: "facilitator_doc",
        source_doc_no: d.doc_no,
      });
  }

  // --- 1e. GovOps (Pattern 5) — entity_type = govops_org ---
  for (const d of allDocs.filter(isGovOpsDoc)) {
    const name = extractAssignment(d.content, "(?:(?:Operational|Core) )?GovOps for [^.]+");
    if (name)
      addEntity(slugify(name), name, "govops_org", null, d.id, {
        source: "govops_doc",
        source_doc_no: d.doc_no,
      });
  }

  // --- 1f. Named Responsible Parties from Active Data Controllers (Pattern 6) ---
  // Only creates ecosystem_actor entities when the RP declaration includes an
  // explicit entity name. Role-only declarations carry no new entity — they are
  // resolved to an existing role-edge target in Section 2s.
  // Skip names that match a role-binding doc's title (e.g. "Core Council Risk
  // Advisor" → A.1.7.1.1.2) so the holder (e.g. BA Labs) gets used in 2s.
  // roleBindingTitles: role definition titles (e.g. "core council risk advisor")
  // derived from direct children of A.1.7.1 so ADC entity creation skips them.
  const roleBindingTitles = new Set();
  const aeaDoc = docById.get(ACTIVE_ECOSYSTEM_ACTORS_UUID);
  if (aeaDoc) {
    const pfx = aeaDoc.doc_no + ".";
    for (const d of allDocs)
      if (d.doc_no.startsWith(pfx) && !d.doc_no.slice(pfx.length).includes(".") && d.title)
        roleBindingTitles.add(d.title.toLowerCase());
  }
  for (const d of allDocs.filter((d) => d.type === "Active Data Controller")) {
    const raw = extractRP(d.content);
    if (!raw) continue;
    const { role, name } = rpRoleAndName(raw);
    if (role && !name) continue; // "Operational GovOps" — no name to create
    if (!name) continue;
    const needle = name.toLowerCase();
    let hitRoleTitle = false;
    for (const t of roleBindingTitles)
      if (t === needle || t.includes(needle)) {
        hitRoleTitle = true;
        break;
      }
    if (hitRoleTitle) continue;
    const s = slugify(name);
    if (entityMap.has(s)) continue;
    addEntity(s, name, "ecosystem_actor", null, d.id, {
      source: "active_data_controller",
      source_doc_no: d.doc_no,
    });
  }

  // --- 1g. ERG members (Pattern 7) ---
  const ergDoc = docById.get(ERG_MEMBERSHIP_UUID);
  if (!ergDoc) console.warn(`[graph] ERG membership doc (${ERG_MEMBERSHIP_UUID}) not found`);
  const ergMemberNames = ergDoc ? extractListItems(ergDoc.content) : [];
  for (const name of ergMemberNames) {
    const s = slugify(name);
    if (!entityMap.has(s)) {
      addEntity(s, name, "ecosystem_actor", null, ergDoc?.id ?? null, {
        source: "erg_list",
        source_doc_no: ergDoc.doc_no,
      });
    }
  }

  // --- 1h. Delegates from addresses.json (labels; entity_type = delegate_org) ---
  const labelToAddresses = new Map();
  for (const [addr, info] of Object.entries(addressesRaw)) {
    if (info.label) {
      const s = slugify(info.label);
      if (!labelToAddresses.has(s)) labelToAddresses.set(s, []);
      labelToAddresses.get(s).push({ addr: addr.toLowerCase(), chain: info.chain ?? "ethereum" });
      if (info.roles?.includes("delegate") && !entityMap.has(s)) {
        addEntity(s, info.label, "delegate_org", null, null, {
          source: "addresses_json_delegate",
          address: addr,
        });
      }
    }
  }

  // --- 1i. Aligned Delegates (Pattern 10) ---
  // The doc is a registry table today (parsed in build-graph Phase 2.7, which
  // also emits aligned_delegate_for edges from the rows); the list/prose paths
  // below are kept as fallbacks should the atlas revert to a plain list.
  const alignedDelegatesDoc = docById.get(ALIGNED_DELEGATES_UUID);
  if (!alignedDelegatesDoc)
    console.warn(`[graph] Aligned Delegates doc (${ALIGNED_DELEGATES_UUID}) not found`);
  const alignedDelegateNames = [];
  if (alignedDelegatesDoc) {
    // Prefer explicit list items, fall back to prose "Aligned Delegates are X, Y, Z."
    const items = extractListItems(alignedDelegatesDoc.content);
    if (items.length) {
      alignedDelegateNames.push(...items);
    } else {
      const m = alignedDelegatesDoc.content?.match(/Aligned Delegates?\s+(?:are|is)\s+([^.]+)\./i);
      if (m) alignedDelegateNames.push(...parseNameList(m[1]));
    }
    for (const name of alignedDelegateNames) {
      const s = slugify(name);
      if (!entityMap.has(s)) {
        addEntity(s, name, "delegate_org", null, alignedDelegatesDoc.id, {
          source: "aligned_delegates_list",
          source_doc_no: alignedDelegatesDoc.doc_no,
        });
      }
    }
  }

  // --- 1j. Ranked Delegates (Pattern 10) ---
  // Levels 1 and 2 have current-members docs; level 3 does not (verified in atlas).
  const rankedDelegatesByLevel = new Map(); // level → [{name, docNo}]
  for (const [level, uuid] of RANKED_DELEGATE_UUIDS) {
    const d = docById.get(uuid);
    if (!d) {
      console.warn(`[graph] Level ${level} Ranked Delegates doc (${uuid}) not found`);
      continue;
    }
    const docNo = d.doc_no;
    const m = d.content?.match(/Ranked Delegates?\s+(?:are|is)\s+([^.]+)\./i);
    if (!m) continue;
    const names = parseNameList(m[1]);
    rankedDelegatesByLevel.set(
      level,
      names.map((name) => ({ name, docNo })),
    );
    for (const name of names) {
      const s = slugify(name);
      if (!entityMap.has(s)) {
        addEntity(s, name, "delegate_org", null, d.id, {
          source: "ranked_delegates_list",
          source_doc_no: docNo,
        });
      }
    }
  }

  // --- 1k. Role bindings: walk A.1.7.1 children for .X.2 binding docs (Pattern 11) ---
  // Each direct child of A.1.7.1 is a role definition; its .2 child is the
  // "Designated X" binding doc that names the holder via "role is held by [Name]."
  const roleBindings = [];
  if (aeaDoc) {
    const pfx = aeaDoc.doc_no + ".";
    const roleDefDocs = allDocs.filter(
      (d) => d.doc_no.startsWith(pfx) && !d.doc_no.slice(pfx.length).includes("."),
    );
    let foundCcra = false;
    for (const roleDef of roleDefDocs) {
      const bindingDoc = docByDocNo.get(roleDef.doc_no + ".2");
      if (!bindingDoc) continue;
      const m = bindingDoc.content?.match(/role is held by\s+([^.]+)\./i);
      if (!m) continue;
      if (bindingDoc.id === CCRA_BINDING_UUID) foundCcra = true;
      const name = m[1].trim();
      const s = slugify(name);
      let entity = entityMap.get(s);
      if (!entity)
        entity = addEntity(s, name, "ecosystem_actor", null, bindingDoc.id, {
          source: "role_binding",
          source_doc_no: bindingDoc.doc_no,
        });
      const roleSlug = roleDef.title.toLowerCase().replace(/\s+/g, "_");
      roleBindings.push({ holder: entity, bindingDoc, roleSlug });
    }
    if (!foundCcra)
      console.warn(`[graph] Expected CCRA binding (${CCRA_BINDING_UUID}) not found — A.1.7.1 may have restructured`);
  }

  // --- 1k1. Role bindings outside the Active Ecosystem Actors walk ---
  // The census found "Designated Synome Editor" (A.1.3.2.1.1, Synome scope):
  // binding docs are not confined to the section 1k walks. Any doc titled
  // "Designated …" with the binding sentence gets the same treatment; the
  // role slug comes from the sentence itself ("The Synome Editor role is
  // held by Archon Tech."). Title gate keeps prose hypotheticals out — a
  // binding doc without the "Designated" title shows up in the census's
  // role-held-by cluster instead of being guessed at here.
  const seenBindingDocs = new Set(roleBindings.map((b) => b.bindingDoc.id));
  for (const d of allDocs) {
    if (seenBindingDocs.has(d.id) || !/\bdesignated\b/i.test(d.title)) continue;
    const m = d.content?.match(/\bThe\s+(.{2,60}?)\s+role is held by\s+([^.\n]+)\./i);
    if (!m) continue;
    const name = m[2].trim();
    if (/^(?:the|a|an|any|another|one|such|that|this|it)\b/i.test(name)) continue;
    const s = slugify(name);
    let entity = entityMap.get(s);
    if (!entity)
      entity = addEntity(s, name, "ecosystem_actor", null, d.id, {
        source: "role_binding",
        source_doc_no: d.doc_no,
      });
    roleBindings.push({
      holder: entity,
      bindingDoc: d,
      roleSlug: m[1].trim().toLowerCase().replace(/\s+/g, "_"),
    });
  }

  // --- 1k2. Spell Team members (Spell Team Configuration doc) ---
  // "Currently, Sky has two teams of technical contributors for Spell
  // development, Dewiz, and Sidestream." Each named team gets a holds_role_for
  // edge to this doc (emitted in Phase 2 alongside the A.1.7.1 bindings).
  const spellTeamDoc = docById.get(SPELL_TEAM_UUID);
  if (spellTeamDoc) {
    const m = spellTeamDoc.content?.match(
      /teams? of technical contributors for Spell development,?\s+(.+?)\.(?:\s|$)/i,
    );
    if (m) {
      for (const name of parseNameList(m[1])) {
        const s = slugify(name);
        let entity = entityMap.get(s);
        if (!entity)
          entity = addEntity(s, name, "ecosystem_actor", null, spellTeamDoc.id, {
            source: "spell_team",
            source_doc_no: spellTeamDoc.doc_no,
          });
        roleBindings.push({ holder: entity, bindingDoc: spellTeamDoc, roleSlug: "spell_team_member" });
      }
    } else {
      console.warn(`[graph] Spell Team doc (${SPELL_TEAM_UUID}) found but member sentence did not parse`);
    }
  } else {
    console.warn(`[graph] Spell Team doc (${SPELL_TEAM_UUID}) not found`);
  }

  // --- 1l. Grant recipients (foundations surface here) ---
  for (const d of allDocs.filter(isGrantDoc)) {
    const m =
      d.content?.match(/\*\s*Recipient:\s*([^\n]+?)(?:\n|$)/i) ??
      d.content?.match(/-\s*Recipient:\s*([^\n]+?)(?:\n|$)/i) ??
      d.content?.match(/\bRecipient:\s*([^\n]+?)(?:\n|$)/i);
    if (!m) continue;
    const name = m[1].trim();
    const s = slugify(name);
    if (entityMap.has(s)) continue;
    const entity_type = /\bFoundation\b/i.test(name) ? "foundation" : "ecosystem_actor";
    addEntity(s, name, entity_type, null, d.id, {
      source: "grant_recipient",
      source_doc_no: d.doc_no,
    });
  }

  // --- 1m. Composite accord parties and members (Pattern 12) ---
  // Scan A.2.8.2.Y.1.1.N party-details docs. Create composite_party entity (suffix "-party"
  // to avoid slug collision with member agent). Resolve or create each member.
  function resolveAccordMember(rawName, sourceDocNo) {
    const cleaned = rawName.replace(/^the\s+/i, "").trim();

    // Sky Core special — party 'Sky' comprises Sky Core; always maps to bootstrap.
    if (/^Sky Core$/i.test(cleaned)) return skyCore;

    // Strip "Prime Agent" or "Executor Agent" suffix to match short agent slugs.
    const stripped = cleaned.replace(/\s+(Prime Agent|Executor Agent)$/i, "").trim();
    if (stripped !== cleaned) {
      const hit = entityMap.get(slugify(stripped));
      if (hit) return hit;
    }

    // Within an A.2.8.2.Y.1.1.N comprises list, any non-agent non-Foundation
    // member is a development_company by the atlas's positional convention
    // (e.g. "The party 'Spark' comprises the Spark Prime Agent, Spark Foundation,
    // and Phoenix Labs." — Phoenix Labs is the dev company). Foundation suffix
    // gives us the foundation vs dev-company split; no hardcoded name list needed.
    const inferredType = /\bFoundation$/i.test(cleaned) ? "foundation" : "development_company";

    const exact = entityMap.get(slugify(cleaned));
    if (exact) {
      // Upgrade a previously-created ecosystem_actor if the accord now classifies it
      // more specifically (e.g. Phoenix Labs first seen in ERG list, then confirmed
      // as dev-company via the Spark accord).
      if (exact.entity_type === "ecosystem_actor") exact.entity_type = inferredType;
      return exact;
    }

    return addEntity(slugify(cleaned), cleaned, inferredType, null, null, {
      source: "accord_party_member",
      source_doc_no: sourceDocNo,
    });
  }

  const compositeBySlug = new Map(); // partySlug (with "-party" suffix) → entity
  const accordPartyDocsByAccordDocNo = new Map(); // accord doc_no → [{ partyEntity, sourceDocNo }]

  for (const d of allDocs.filter(isPartyDetails)) {
    const comprisesMatch = d.content?.match(COMPRISES_RE);
    const atomicMatch = !comprisesMatch ? d.content?.match(ATOMIC_PARTY_RE) : null;
    if (!comprisesMatch && !atomicMatch) continue;
    const partyName = (comprisesMatch?.[1] ?? atomicMatch[1]).trim();
    const memberStr = comprisesMatch?.[2] ?? "";

    // Accord doc_no = first 5 parts of party-details doc_no (e.g. A.2.8.2.2 ← A.2.8.2.2.1.1.2)
    const accordDocNo = d.doc_no.split(".").slice(0, 5).join(".");

    // The "Sky" party maps directly to Sky Core (bootstrap) — no separate composite.
    let partyEntity;
    if (/^Sky$/i.test(partyName)) {
      partyEntity = skyCore;
    } else {
      const partySlug = `${slugify(partyName)}-party`;
      partyEntity = compositeBySlug.get(partySlug);
      if (!partyEntity) {
        partyEntity = addEntity(partySlug, partyName, "composite_party", null, null, {
          source: "accord_party_composite",
          source_doc_no: d.doc_no,
        });
        compositeBySlug.set(partySlug, partyEntity);
      }
    }

    if (!accordPartyDocsByAccordDocNo.has(accordDocNo))
      accordPartyDocsByAccordDocNo.set(accordDocNo, []);
    accordPartyDocsByAccordDocNo
      .get(accordDocNo)
      .push({ partyEntity, sourceDocNo: d.doc_no, memberStr, isSky: /^Sky$/i.test(partyName) });

    // Resolve members now so they exist before edges are emitted in Phase 2.
    for (const memberName of parseNameList(memberStr)) {
      resolveAccordMember(memberName, d.doc_no);
    }
  }

  // --- 1i. Primitive Instance entities (Pattern: per-agent ICD → entity) ---
  const childrenByDocNo = buildChildrenIndex(allDocs);
  const knownPrimitives = buildKnownPrimitives(docById);

  for (const icd of allDocs.filter((d) => isICD(d) && d.doc_no.startsWith("A.6.1.1."))) {
    const primRoot = primitiveRootFor(icd, docByDocNo);
    if (!primRoot) continue;

    const agentMatch = icd.doc_no.match(/^(A\.6\.1\.1\.\d+)(?:\.|$)/);
    const agentDoc = agentMatch ? docByDocNo.get(agentMatch[1]) : null;
    const agentSlug = agentDoc ? slugify(agentDoc.title) : "unknown";

    const { kind, status } = classifyIcd(icd, primRoot, docByDocNo);
    const params = extractInstanceParams(icd, childrenByDocNo);
    const primitiveSlug = primitiveSlugFromTitle(primRoot.title);
    const name = deriveInstanceName(icd, primRoot, agentDoc, params);
    const slug = `${agentSlug}-${primitiveSlug}-${slugify(name)}`;
    const categoryDocNo = primRoot.doc_no.slice(0, primRoot.doc_no.lastIndexOf("."));
    const categoryDoc = docByDocNo.get(categoryDocNo) ?? null;
    const isUnknown = !knownPrimitives.has(primRoot.title);
    // kind === null falls back to "instance" so out-of-scope ICDs still get a
    // graph entity (their status will be null). Per-atlas, the only valid kinds
    // are "instance" and "invocation".
    const entityType = kind === "invocation" ? "invocation" : "instance";
    const ent = addEntity(slug, name, entityType, primitiveSlug, icd.id, {
      agent_doc_id: agentDoc?.id ?? null,
      primitive_category_doc_id: categoryDoc?.id ?? null,
      is_unknown_primitive: isUnknown || undefined,
      status,
      params,
    });
    ent.id = icd.id;
  }

  // --- 1j. Primitive entities (per-agent primitive root → entity) ---
  // One entity per (agent, primitive) — emitted whether or not the primitive
  // has instances. Status comes from the Primitive Hub Document's Global
  // Activation Status leaf.
  const PRIMITIVE_ROOT_RE = /^A\.6\.1\.1\.\d+\.2\.\d+\.\d+$/;
  for (const primRoot of allDocs) {
    if (!PRIMITIVE_ROOT_RE.test(primRoot.doc_no)) continue;
    if (!/Primitive$/i.test(primRoot.title)) continue;

    const agentMatch = primRoot.doc_no.match(/^(A\.6\.1\.1\.\d+)\./);
    const agentDoc = agentMatch ? docByDocNo.get(agentMatch[1]) : null;
    if (!agentDoc) continue;
    const agentSlug = slugify(agentDoc.title);

    const primitiveSlug = primitiveSlugFromTitle(primRoot.title);
    const slug = `${agentSlug}-${primitiveSlug}`;
    const status = primitiveStatusFor(primRoot, docByDocNo);

    const categoryDocNo = primRoot.doc_no.slice(0, primRoot.doc_no.lastIndexOf("."));
    const categoryDoc = docByDocNo.get(categoryDocNo) ?? null;
    const isUnknown = !knownPrimitives.has(primRoot.title);

    addEntity(slug, primRoot.title, "primitive", primitiveSlug, primRoot.id, {
      agent_doc_id: agentDoc.id,
      primitive_category_doc_id: categoryDoc?.id ?? null,
      status,
      is_unknown_primitive: isUnknown || undefined,
    });
  }

  const entityByDocId = new Map();
  for (const e of entityMap.values()) {
    if (e.defining_doc_id) entityByDocId.set(e.defining_doc_id, e);
  }
  return {
    entityMap,
    entityByDocId,
    entityByName,
    labelToAddresses,
    alignedDelegateNames,
    rankedDelegatesByLevel,
    roleBindings,
    ergDoc,
    ergMemberNames,
    accordPartyDocsByAccordDocNo,
    resolveAccordMember,
    childrenByDocNo,
    roleBindingTitles,
  };
}
