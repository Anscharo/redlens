/**
 * Multisig extraction (Pattern 17) for build-graph.
 *
 * The atlas documents every multisig as a parent doc with a regular set of
 * child Cores (titles matched by suffix — prefixes vary per multisig):
 *   …Address                       "The address of the X on {Chain} is `0x…`."
 *   …(Required )Number Of Signers  "The X (currently )has a M/N signing requirement."
 *   …(Current )Signers             three prose/bullet shapes, see parseSignerGroups
 *   …Usage Standards               purpose prose
 *   …(Signer )Modification(s)      who may change the signers + invariants
 *
 * Detection keys on the children (a parent with both a signers doc and a
 * threshold doc), NOT the parent title — roots are not uniformly titled
 * ("Core Council Buffer", "Multisig Freeze Of SparkLend"). The display name
 * is the subject of the threshold sentence, which IS uniform.
 *
 * Emits one `multisig` entity per root (id = root doc UUID) plus:
 *   signer_of              signer entity → multisig   meta.signer_count, meta.via_role?
 *   can_modify_signers_of  entity → multisig
 *   has_address            multisig → address
 *   defines_entity         root doc → multisig
 *
 * Never-silent: every detected root reports parse failures as warnings.
 */

import { slugify, normalizeKey, buildNameIndex, parseNameList } from "./graph-patterns.mjs";
import { normalizeChainLabel } from "./chains.mjs";
import { normalizeAddress } from "./address-chains.mjs";

const THRESHOLD_RE = /The (.+?) (?:currently )?has a (\d+)\/(\d+) signing requirement/;
const ADDRESS_RE = /`([A-Za-z0-9]{32,64})`/;
const ADDRESS_CHAIN_RE = /\baddress of .+? on (?:the )?([A-Z][\w ]*?) is/;
// "three (3) addresses controlled by Operational GovOps Soter Labs"
const SIGNER_GROUP_RE =
  /\((\d+)\)\s*address(?:es)?(?:\s+(?:are|is))?\s+controlled by\s+(.+?)(?=\s*[,;.]|\s+and\s+[a-z]+\s*\(\d+\)|$)/gi;
// "- Soter Labs: 2 signers"
const SIGNER_BULLET_COUNT_RE = /^[-*]\s*([^:\n]+?):\s*(\d+)\s*signers?\s*$/gim;
// plain bullet roster ("- VoteWizard") — only read when the prose announces it
const SIGNER_ROSTER_INTRO_RE = /has the following signers/i;
const SIGNER_BULLET_PLAIN_RE = /^[-*]\s*([A-Za-z0-9_ .'-]+?)\s*$/gm;
const MODIFICATION_RE = /^(.+?) can change the signers/ms;
// "addresses controlled by the Core Facilitator" — bare role references
const ROLE_PREFIX_RE = /^(Operational|Core)\s+(GovOps|Facilitator)\s+(.+)$/i;

function childSuffix(title) {
  const t = title.trim();
  if (/required number of signers$|(?<!of )number of signers$/i.test(t)) return "threshold";
  if (/(?:current )?signers$/i.test(t)) return "signers";
  if (/address$/i.test(t)) return "address";
  if (/usage standards$/i.test(t)) return "usage";
  if (/(?:signer )?modifications?$/i.test(t)) return "modification";
  return null;
}

export function parseSignerGroups(content) {
  const groups = [];
  for (const m of content.matchAll(SIGNER_GROUP_RE)) {
    groups.push({ name: m[2].trim(), count: Number(m[1]) });
  }
  if (groups.length) return groups;
  for (const m of content.matchAll(SIGNER_BULLET_COUNT_RE)) {
    groups.push({ name: m[1].trim(), count: Number(m[2]) });
  }
  if (groups.length) return groups;
  if (SIGNER_ROSTER_INTRO_RE.test(content)) {
    for (const m of content.matchAll(SIGNER_BULLET_PLAIN_RE)) {
      groups.push({ name: m[1].trim(), count: 1 });
    }
  }
  return groups;
}

export function extractMultisigs(allDocs, docById, docByDocNo, entityMap, edges) {
  const nameIndex = buildNameIndex(entityMap);
  const entityById = new Map([...entityMap.values()].map((e) => [e.id, e]));

  // Bare role references resolve to the current holder via existing role edges.
  const roleHolders = new Map(); // normalized role phrase → { entity, role }
  const holderFromEdge = (edgeType) => {
    const ids = [...new Set(edges.filter((e) => e.edgeType === edgeType).map((e) => e.fromId))];
    return ids.length === 1 ? entityById.get(ids[0]) : null;
  };
  const coreFac = holderFromEdge("core_facilitator_for");
  const coreGov = holderFromEdge("core_govops_for");
  const opGov = holderFromEdge("operational_govops_for");
  if (coreFac) roleHolders.set("corefacilitator", { entity: coreFac, role: "core_facilitator" });
  if (coreGov) roleHolders.set("coregovops", { entity: coreGov, role: "core_govops" });
  if (opGov) roleHolders.set("operationalgovops", { entity: opGov, role: "operational_govops" });

  // Resolve a signer/modifier name to an entity, creating a fallback
  // ecosystem_actor (or foundation) when the atlas names someone we have not
  // seen elsewhere (e.g. VoteWizard, Spark Assets Foundation).
  function resolveParty(rawName, sourceDoc, addEntity) {
    let name = rawName.trim().replace(/^the\s+/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (!name) return null;

    const bare = roleHolders.get(normalizeKey(name));
    if (bare) return { entity: bare.entity, viaRole: bare.role };

    const m = name.match(ROLE_PREFIX_RE);
    if (m) {
      const inner = nameIndex.get(normalizeKey(m[3]));
      if (inner) return { entity: inner, viaRole: null };
      const bareRole = roleHolders.get(normalizeKey(`${m[1]} ${m[2]}`));
      if (bareRole) return { entity: bareRole.entity, viaRole: bareRole.role };
    }

    const direct = nameIndex.get(normalizeKey(name));
    if (direct) return { entity: direct, viaRole: null };

    const et = /\bFoundation$/i.test(name) ? "foundation" : "ecosystem_actor";
    const created = addEntity(slugify(name), name, et, null, null, {
      source: "multisig_party",
      source_doc_no: sourceDoc.doc_no,
    });
    nameIndex.set(normalizeKey(name), created);
    return { entity: created, viaRole: null, created: true };
  }

  // --- Detect roots: group candidate children by parent doc_no ---
  const byParent = new Map(); // parent doc_no → { threshold?, signers?, address?, usage?, modification? }
  for (const d of allDocs) {
    const kind = childSuffix(d.title);
    if (!kind) continue;
    const parentDocNo = d.doc_no.split(".").slice(0, -1).join(".");
    let slot = byParent.get(parentDocNo);
    if (!slot) { slot = {}; byParent.set(parentDocNo, slot); }
    if (!slot[kind]) slot[kind] = d;
  }

  const stats = { roots: 0, signerEdges: 0, modifierEdges: 0, created: 0, warnings: 0 };
  const warn = (msg) => { stats.warnings++; console.warn(`  multisig: ${msg}`); };

  return {
    run(addEntity) {
      for (const [parentDocNo, slot] of [...byParent.entries()].sort()) {
        if (!slot.threshold || !slot.signers) continue; // not a multisig group
        const root = docByDocNo.get(parentDocNo);
        if (!root) continue;
        stats.roots++;

        // Display name = subject of the threshold sentence (uniform across
        // variants); fall back to the root title.
        const thresholdMatch = (slot.threshold.content ?? "").match(THRESHOLD_RE);
        if (!thresholdMatch) warn(`threshold did not parse: ${slot.threshold.doc_no}`);
        const name = thresholdMatch?.[1]?.trim() ?? root.title;
        const threshold = thresholdMatch ? `${thresholdMatch[2]}/${thresholdMatch[3]}` : null;

        // Address + chain (parsed before naming — chain is the first
        // collision disambiguator below).
        let address = null, chain = "ethereum";
        if (slot.address) {
          const am = (slot.address.content ?? "").match(ADDRESS_RE);
          if (am) {
            address = normalizeAddress(am[1]);
            chain = am[1].startsWith("0x")
              ? normalizeChainLabel((slot.address.content ?? "").match(ADDRESS_CHAIN_RE)?.[1])
              : "solana";
          } else warn(`address did not parse: ${slot.address.doc_no}`);
        }

        // Agent-subtree multisigs get the agent prefix (five agents each have
        // a "Freezer Multisig"). Remaining collisions are per-chain deployments
        // of the same logical multisig (e.g. Keel's Solana relayer) — suffix
        // the chain; cross-scope collisions fall back to the scope title.
        const agentDoc = docByDocNo.get(root.doc_no.match(/^(A\.6\.1\.1\.\d+)\./)?.[1] ?? "");
        let displayName = agentDoc && !name.toLowerCase().includes(agentDoc.title.toLowerCase())
          ? `${agentDoc.title} ${name}`
          : name;
        let slug = slugify(displayName);
        if (entityMap.has(slug)) {
          // Chain suffix only helps when the colliding multisig is on a
          // different chain (same logical multisig, per-chain deployments).
          let otherChain = null;
          try { otherChain = JSON.parse(entityMap.get(slug).meta ?? "{}").chain; } catch { /* ignore */ }
          if (otherChain && otherChain !== chain) {
            const chainLabel = chain[0].toUpperCase() + chain.slice(1);
            displayName = `${displayName} (${chainLabel})`;
            slug = slugify(displayName);
          }
        }
        if (entityMap.has(slug)) {
          const scopeDoc = docByDocNo.get(root.doc_no.split(".").slice(0, 2).join("."));
          displayName = scopeDoc ? `${name} (${scopeDoc.title})` : displayName;
          slug = slugify(displayName);
        }
        if (entityMap.has(slug)) { warn(`slug collision, skipped: ${root.doc_no} (${slug})`); continue; }

        const ent = addEntity(slug, displayName, "multisig", null, root.id, {
          source: "multisig_pattern",
          address,
          chain: address ? chain : null,
          threshold,
          threshold_doc_no: slot.threshold.doc_no,
          purpose_doc_no: slot.usage?.doc_no ?? null,
        });
        ent.id = root.id; // doc UUID is the entity id, like instances
        edges.push({
          fromId: root.id, fromType: "doc", toId: ent.id, toType: "entity",
          edgeType: "defines_entity", sourceDocNos: [],
        });
        if (address) {
          edges.push({
            fromId: ent.id, fromType: "entity", toId: `${address}:${chain}`, toType: "address",
            edgeType: "has_address", sourceDocNos: [slot.address.doc_no],
          });
        }

        // Signers
        const groups = parseSignerGroups(slot.signers.content ?? "");
        if (!groups.length) warn(`signers did not parse: ${slot.signers.doc_no}`);
        for (const g of groups) {
          const r = resolveParty(g.name, slot.signers, addEntity);
          if (!r) { warn(`unresolvable signer "${g.name}" (${slot.signers.doc_no})`); continue; }
          if (r.created) stats.created++;
          edges.push({
            fromId: r.entity.id, fromType: "entity", toId: ent.id, toType: "entity",
            edgeType: "signer_of", sourceDocNos: [slot.signers.doc_no],
            meta: JSON.stringify({ signer_count: g.count, ...(r.viaRole ? { via_role: r.viaRole } : {}) }),
          });
          stats.signerEdges++;
        }

        // Modification authority ("The signers can change…" is self-referential — skip)
        const modMatch = (slot.modification?.content ?? "").match(MODIFICATION_RE);
        if (modMatch && !/^the signers$/i.test(modMatch[1].trim())) {
          for (const rawName of parseNameList(modMatch[1])) {
            const r = resolveParty(rawName, slot.modification, addEntity);
            if (!r) { warn(`unresolvable modifier "${rawName}" (${slot.modification.doc_no})`); continue; }
            if (r.created) stats.created++;
            edges.push({
              fromId: r.entity.id, fromType: "entity", toId: ent.id, toType: "entity",
              edgeType: "can_modify_signers_of", sourceDocNos: [slot.modification.doc_no],
              meta: r.viaRole ? JSON.stringify({ via_role: r.viaRole }) : undefined,
            });
            stats.modifierEdges++;
          }
        }
      }
      return stats;
    },
  };
}
