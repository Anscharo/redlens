/**
 * Active Data table entity extraction (Pattern 16) for build-graph, Phase 2.7.
 *
 * Parses five Active Data tables that contain named actors not captured by
 * the prose-pattern phases above:
 *   - Current Aligned Delegates          (5f584db8) — delegate_org, is_active=1
 *   - Derecognized Delegates             (e7aec672) — delegate_org, is_active=0
 *   - SRC Membership Registry            (d9c6ed16) — src_member, is_active=1
 *   - Current Authorized Forum Accounts  (b71564fd) — named individuals/orgs
 *   - Aligned Delegate Breach Registry   (1ddd9cf6) — dated breach events
 *
 * For existing delegate_org entities (bootstrapped from chainlog addresses),
 * enriches meta with forum_url and updates has_address edge role metadata.
 * Creates new entities for delegates absent from the chainlog (e.g. BLUE,
 * Cloaky) and registers their addresses in addressesAtlas (written to
 * public/addresses.atlas.json, further enriched in Phase 4.5) and
 * addressesRaw (reflected in the Phase 3 address count).
 *
 * Also runs a drift detector: any other Active Data table that gains rows
 * (e.g. the 29 per-instance payment ledgers, all empty today) warns loudly
 * instead of being silently ignored.
 *
 * See .claude/skills/parse-atlas/SKILL.md Pattern 16 for the full reference.
 */

import {
  slugify,
  normalizeKey,
  buildNameIndex,
  resolveAliasedEntity,
  makeEntity,
} from "./graph-patterns.mjs";
import {
  parseMarkdownTable,
  extractEthAddresses,
  extractUrl,
} from "./table-parser.mjs";

const CURRENT_DELEGATES_UUID = "5f584db8-f8d8-4118-988c-b2bc3f68ceb7";
const DERECOGNIZED_UUID = "e7aec672-ed19-4329-aaf7-736950be2eb7";
const SRC_UUID = "d9c6ed16-5b0d-4a6f-bb43-387398090afc";
const FORUM_ACCOUNTS_UUID = "b71564fd-22e0-4c69-99d1-5b23fc1fa329"; // A.2.7.1.1.1.1.4.0.6.1
const BREACH_REGISTRY_UUID = "1ddd9cf6-3f93-4a33-8c1d-80405eec1ffb"; // A.1.6.6.1.3.0.6.1
// Tables we deliberately do not extract (the drift detector skips them):
// Registered Spell Checklists — external GitHub URLs, no graph value.
// Current/Previous Sky Direct Exposures (triaged 2026-08-11, issues #260/#262,
// atlas c077dc3) — rows name assets/pools ("Treasury Bills", "Uniswap Pools"),
// not actors, and attribution ("Investments by Grove in ... on Ethereum
// Mainnet") lives in a free-text Description cell. None of the existing
// entity_types fit a designated-exposure row; modeling one (and parsing the
// attribution prose) is a deliberate deferral, not a mechanical regex
// extension — see parse-atlas SKILL.md Pattern 16 addendum.
// Approved Deviations (triaged 2026-08-28, issue #339, atlas 1704409) — a
// registry of exceptions to the default multisig signer/threshold config
// (Pattern 17), keyed by Liquidity Layer name + multisig address, not by a
// named actor. Its one row today ("Spark Liquidity Layer" /
// `0x90D8c80C028B4C09C0d8dcAab9bbB057F0513431` / "Two (2) of four (4) signing
// requirement, with signers controlled by Phoenix Labs and VoteWizard") reads
// as free-text prose in the third column, not a structured field — same
// deferral shape as the Sky Direct Exposures tables above, not a Pattern 16
// fit. A future extractor would need to resolve the Multisig Address column
// against the Pattern 17 multisig entity (by address) and treat the
// Approved Deviation cell as an alternate-config annotation on it.
const KNOWN_UNEXTRACTED_TABLES = new Set([
  "93f5b36b-06a7-4282-9fd7-14e0cbafd08e", // A.1.10.2.5.1.3.2.0.6.1
  "5f368e33-7a82-4244-a9ba-f285193ec043", // A.2.2.10.1.1.1.1.2.0.6.1 List Of Current Sky Direct Exposures
  "86fce840-f7f3-4617-bb58-d04db8731c9d", // A.2.2.10.1.1.1.1.3.0.6.1 List Of Previous Sky Direct Exposures
  "c304cb9f-ab10-4d5b-8f94-588170b36a9e", // A.2.2.10.1.1.1.6.2.1.3.1.0.6.1 Approved Deviations
]);

// Runs after Phase 2.5 (ICD-param has_address edges) so `edges` already
// carries every entity → address link Table 1 needs for identity lookup, and
// after Phase 1 so `entityMap` already has sky-governance bootstrapped.
// Mutates entityMap / edges / addressesAtlas / addressesRaw in place (the
// established convention for phase modules — see graph-multisigs.mjs).
export function extractActiveData(allDocs, docById, entityMap, edges, addressesAtlas, addressesRaw) {
  // Reverse map: address (no chain suffix) → entity id, from existing has_address edges
  const addrToEntityId = new Map();
  for (const edge of edges) {
    if (edge.edgeType === "has_address" && edge.fromType === "entity") {
      addrToEntityId.set(edge.toId.split(":")[0], edge.fromId);
    }
  }
  const entityById = new Map([...entityMap.values()].map((e) => [e.id, e]));

  function addTableEntity(slug, name, et, isActive, defDocId, meta) {
    const entity = makeEntity(slug, name, et, {
      defining_doc_id: defDocId,
      is_active: isActive,
      meta,
    });
    entityMap.set(slug, entity);
    entityById.set(entity.id, entity);
    return entity;
  }

  function addTableEdge(fromId, fromType, toId, toType, edgeType, meta) {
    edges.push({ fromId, fromType, toId, toType, edgeType, meta: meta ? JSON.stringify(meta) : undefined });
  }

  // Record a short-name alias ("Redline") on an entity resolved by its full
  // name ("Redline Facilitation Group") via resolveAliasedEntity's prefix
  // fallback, so entity search (entity-resolve.ts scoreEntity) can still find
  // it on the short form once the two rows have merged into one entity.
  function addAlias(entity, alias) {
    const m = JSON.parse(entity.meta ?? "{}");
    const aliases = new Set(m.aliases ?? []);
    aliases.add(alias);
    m.aliases = [...aliases];
    entity.meta = JSON.stringify(m);
  }

  let enriched = 0, created = 0, derecognized = 0, srcMembers = 0;
  const skyGovernance = entityMap.get("sky-governance");

  // --- Table 1: Current Aligned Delegates ---
  const delegatesDoc = docById.get(CURRENT_DELEGATES_UUID);
  if (delegatesDoc) {
    for (const row of parseMarkdownTable(delegatesDoc.content ?? "")) {
      const name = row["Delegate Name"]?.trim();
      if (!name) continue;
      const eaAddr = extractEthAddresses(row["EA Address"] ?? "")[0];
      const contractAddr = extractEthAddresses(row["Delegation Contract"] ?? "")[0];
      const forumUrl = extractUrl(row["Forum Post"] ?? "");
      if (!eaAddr) continue;

      const existingId = addrToEntityId.get(eaAddr);
      const entity = existingId ? entityById.get(existingId) : null;

      if (entity) {
        // Enrich: add forum_url to meta, update has_address edge roles.
        // Also upgrade ecosystem_actor → delegate_org (e.g. entities that appear
        // in the ERG list get created as ecosystem_actor first; delegate table wins).
        if (entity.entity_type === "ecosystem_actor") entity.entity_type = "delegate_org";
        const m = JSON.parse(entity.meta ?? "{}");
        if (forumUrl) m.forum_url = forumUrl;
        entity.meta = JSON.stringify(m);

        for (const edge of edges) {
          if (edge.edgeType !== "has_address" || edge.fromId !== entity.id) continue;
          const addr = edge.toId.split(":")[0];
          if (addr === eaAddr) edge.meta = JSON.stringify({ role: "ea_address" });
          else if (contractAddr && addr === contractAddr) edge.meta = JSON.stringify({ role: "delegation_contract" });
        }
        enriched++;
      } else {
        // New entity — register addresses, emit has_address edges
        const s = slugify(name);
        const ent = addTableEntity(s, name, "delegate_org", 1, CURRENT_DELEGATES_UUID, {
          source: "active_data_table",
          forum_url: forumUrl,
        });
        for (const [addr, role] of [[eaAddr, "ea_address"], [contractAddr, "delegation_contract"]]) {
          if (!addr) continue;
          if (!addressesAtlas[addr]) {
            const label = role === "ea_address" ? name : `${name} Delegation Contract`;
            addressesAtlas[addr] = { chain: "ethereum", chains: ["ethereum"], roles: ["delegate"], entityLabel: label };
            addressesRaw[addr] = { ...addressesAtlas[addr], label, aliases: [] };
          }
          addTableEdge(ent.id, "entity", `${addr}:ethereum`, "address", "has_address", { role });
        }
        created++;
      }

      const rowEntityId = entity?.id ?? entityMap.get(slugify(name))?.id;
      addTableEdge(rowEntityId, "entity", CURRENT_DELEGATES_UUID, "doc", "listed_in", null);
      // Inclusion in this registry IS Aligned Delegate recognition (Pattern 10).
      // The doc used to be a prose list (handled in Phase 2 as a fallback);
      // as a table, the role edges are emitted here.
      if (rowEntityId && skyGovernance) {
        edges.push({
          fromId: rowEntityId, fromType: "entity", toId: skyGovernance.id, toType: "entity",
          edgeType: "aligned_delegate_for", sourceDocNos: [delegatesDoc.doc_no],
        });
      }
    }
  }

  // --- Table 2: Derecognized Alignment Conservers ---
  const derecognizedDoc = docById.get(DERECOGNIZED_UUID);
  if (derecognizedDoc) {
    for (const row of parseMarkdownTable(derecognizedDoc.content ?? "")) {
      const name = row["Identity"]?.trim();
      if (!name || name === "-") continue;
      const s = slugify(name);
      if (entityMap.has(s)) continue;
      const ent = addTableEntity(s, name, "delegate_org", 0, DERECOGNIZED_UUID, {
        source: "active_data_table",
        derecognition_date: row["Date"]?.trim(),
        forum_url: extractUrl(row["Reasoning Post"] ?? ""),
      });
      addTableEdge(ent.id, "entity", DERECOGNIZED_UUID, "doc", "listed_in", null);
      derecognized++;
    }
  }

  // --- Table 3: SRC Membership Registry ---
  const srcDoc = docById.get(SRC_UUID);
  if (srcDoc) {
    for (const row of parseMarkdownTable(srcDoc.content ?? "")) {
      const name = row["Name or Alias"]?.trim();
      if (!name) continue;
      const s = slugify(name);
      if (entityMap.has(s)) continue;
      const ent = addTableEntity(s, name, "src_member", 1, SRC_UUID, {
        source: "active_data_table",
        domain_expertise: row["Domain Expertise"]?.trim(),
        start_date: row["Start Date"]?.trim(),
        term_status: row["Term Status"]?.trim(),
        standing: row["Standing"]?.trim(),
      });
      const govRaw = row["Verified Governance Address"]?.trim();
      if (govRaw && govRaw !== "N/A") {
        for (const addr of extractEthAddresses(govRaw)) {
          if (!addressesAtlas[addr]) {
            addressesAtlas[addr] = { chain: "ethereum", chains: ["ethereum"], roles: ["governance"], entityLabel: name };
            addressesRaw[addr] = { ...addressesAtlas[addr], label: name, aliases: [] };
          }
          addTableEdge(ent.id, "entity", `${addr}:ethereum`, "address", "has_address", { role: "governance" });
        }
      }
      addTableEdge(ent.id, "entity", SRC_UUID, "doc", "listed_in", null);
      srcMembers++;
    }
  }

  // --- Table 4: Current Authorized Forum Accounts ---
  // Columns: Entity Name | Role | Entity Handle | Handles of Authorized
  // Representatives. Row entities get meta.forum_handle; each rep handle
  // becomes an ecosystem_actor (st="individual") with an authorized_rep_for
  // edge to the org. Reps that resolve to existing orgs (e.g. "SoterLabs" for
  // Amatsu) reuse that entity rather than creating an individual.
  let forumRows = 0, forumReps = 0;
  const forumDoc = docById.get(FORUM_ACCOUNTS_UUID);
  if (forumDoc) {
    const nameIndex = buildNameIndex(entityMap);
    const registerInIndex = (e) => {
      for (const key of [normalizeKey(e.name), normalizeKey(e.slug)])
        if (key && !nameIndex.has(key)) nameIndex.set(key, e);
    };
    for (const row of parseMarkdownTable(forumDoc.content ?? "")) {
      const name = row["Entity Name"]?.trim();
      if (!name || name === "N/A") continue;
      let entity = resolveAliasedEntity(nameIndex, entityMap, name);
      if (!entity) {
        entity = addTableEntity(slugify(name), name, "ecosystem_actor", 1, FORUM_ACCOUNTS_UUID, {
          source: "forum_accounts_table",
        });
        registerInIndex(entity);
      } else {
        nameIndex.set(normalizeKey(name), entity); // cache the short-name alias too
        if (normalizeKey(name) !== normalizeKey(entity.name) && normalizeKey(name) !== normalizeKey(entity.slug))
          addAlias(entity, name);
      }
      const handle = row["Entity Handle"]?.trim();
      const role = row["Role"]?.trim();
      const m = JSON.parse(entity.meta ?? "{}");
      if (handle && handle !== "N/A") m.forum_handle = handle;
      if (role && role !== "N/A") m.forum_role = role;
      entity.meta = JSON.stringify(m);
      addTableEdge(entity.id, "entity", FORUM_ACCOUNTS_UUID, "doc", "listed_in", {
        handle: handle !== "N/A" ? handle : undefined,
        role: role !== "N/A" ? role : undefined,
      });
      forumRows++;

      const repsRaw = (row["Handles of Authorized Representatives"] ?? "")
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .trim();
      if (!repsRaw || repsRaw === "N/A") continue;
      for (const handleName of repsRaw.split(/,\s*/).map((s) => s.trim()).filter(Boolean)) {
        let rep = resolveAliasedEntity(nameIndex, entityMap, handleName);
        if (!rep) {
          rep = addTableEntity(slugify(handleName), handleName, "ecosystem_actor", 1, FORUM_ACCOUNTS_UUID, {
            source: "forum_accounts_table",
            forum_handle: handleName,
          });
          rep.subtype = "individual";
          registerInIndex(rep);
        } else {
          nameIndex.set(normalizeKey(handleName), rep); // cache the short-name alias too
          if (normalizeKey(handleName) !== normalizeKey(rep.name) && normalizeKey(handleName) !== normalizeKey(rep.slug))
            addAlias(rep, handleName);
        }
        if (rep.id === entity.id) continue;
        addTableEdge(rep.id, "entity", entity.id, "entity", "authorized_rep_for", {
          handle: handleName,
        });
        forumReps++;
      }
    }
  } else {
    console.warn(`  Phase 2.7: Forum Accounts doc (${FORUM_ACCOUNTS_UUID}) not found`);
  }

  // --- Table 5: Aligned Delegate Breach Registry ---
  // Columns: Date | Identity | Breach Tier | Reasoning Post. Rows are dated
  // governance events attached to existing delegate entities via listed_in.
  let breaches = 0;
  const breachDoc = docById.get(BREACH_REGISTRY_UUID);
  if (breachDoc) {
    const nameIndex = buildNameIndex(entityMap);
    for (const row of parseMarkdownTable(breachDoc.content ?? "")) {
      const identity = row["Identity"]?.trim();
      if (!identity) continue;
      let entity = nameIndex.get(normalizeKey(identity));
      if (!entity) {
        entity = addTableEntity(slugify(identity), identity, "delegate_org", 1, BREACH_REGISTRY_UUID, {
          source: "breach_registry_table",
        });
        nameIndex.set(normalizeKey(identity), entity);
      }
      addTableEdge(entity.id, "entity", BREACH_REGISTRY_UUID, "doc", "listed_in", {
        date: row["Date"]?.trim(),
        breach_tier: row["Breach Tier"]?.trim(),
        reasoning_url: extractUrl(row["Reasoning Post"] ?? "") ?? undefined,
      });
      breaches++;
    }
  } else {
    console.warn(`  Phase 2.7: Breach Registry doc (${BREACH_REGISTRY_UUID}) not found`);
  }

  console.log(
    `\n  Phase 2.7: ${enriched} delegates enriched, ${created} created,` +
    ` ${derecognized} derecognized, ${srcMembers} SRC members,` +
    ` ${forumRows} forum rows (${forumReps} rep edges), ${breaches} breaches`,
  );

  // --- Drift detector: Active Data tables we are not extracting ---
  // Fires when any Active Data doc outside the handled/known-ignored sets
  // gains table rows — e.g. the 29 per-instance payment ledgers (all empty
  // today) or the Registered Multisigs registry. Loud by design.
  const HANDLED_TABLE_UUIDS = new Set([
    CURRENT_DELEGATES_UUID, DERECOGNIZED_UUID, SRC_UUID, FORUM_ACCOUNTS_UUID, BREACH_REGISTRY_UUID,
  ]);
  let driftWarnings = 0;
  for (const d of allDocs) {
    if (d.type !== "Active Data") continue;
    if (HANDLED_TABLE_UUIDS.has(d.id) || KNOWN_UNEXTRACTED_TABLES.has(d.id)) continue;
    const rows = parseMarkdownTable(d.content ?? "").filter((row) =>
      Object.values(row).some((v) => v && v.trim()),
    );
    if (!rows.length) continue;
    driftWarnings++;
    console.warn(
      `  [drift] unextracted Active Data table: ${d.doc_no} "${d.title}" (${d.id}, ${rows.length} rows)`,
    );
  }
  if (driftWarnings) {
    console.warn(`  [drift] ${driftWarnings} Active Data table(s) contain rows but are not extracted`);
  }

  return { enriched, created, derecognized, srcMembers, forumRows, forumReps, breaches, driftWarnings };
}
