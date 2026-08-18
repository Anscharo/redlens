/**
 * Bridge validator set extraction (Pattern 21) for build-graph.
 *
 * Cross-chain bridges document their validator configuration as a parent doc
 * (the bridge-component root) with a regular pair of child Cores:
 *   …Validators           "The validators for the {Component} are A, B, and C."
 *   …Quorum Requirement   "The quorum requirement for the {Component} is M/N."
 *
 * Two shapes carry the pair today:
 *   SkyLink (A.1.10.4.1.*): "{Network} SkyLink Bridge" → … → "Validators" →
 *     "{Token|Governance} Bridge" (root) → pair
 *   SLL Governance Bridge (incoming via atlas PRs #230/#233):
 *     "Governance Bridge Validators" hub → "{Network}" (root) → pair
 *
 * Detection keys on the CHILD PAIR — both sentences must parse — never on
 * titles alone: "Quorum Requirement" also appears as Root Edit Primitive spec
 * prose with no roster sibling (A.2.2.6.*), which must not match.
 *
 * Emits one `bridge` entity per root (id = root doc UUID) plus:
 *   validator_of    ecosystem_actor(st=bridge_validator) → bridge
 *   defines_entity  root doc → bridge
 * The quorum lives on the bridge meta; meta.quorum_doc_no carries provenance
 * so the census counts the quorum doc as covered (same mechanism as the
 * multisig threshold_doc_no fix).
 *
 * Never-silent: a pair whose subjects disagree, or a roster that yields no
 * names, reports a warning instead of dropping data silently.
 */

import {
  slugify,
  normalizeKey,
  buildNameIndex,
  parseNameList,
  makeWarn,
  groupChildrenByParent,
} from "./graph-patterns.mjs";

const ROSTER_RE = /The validators for the (.+?) are (.+?)\./;
const QUORUM_RE = /The quorum requirement for the (.+?) is (\d+)\/(\d+)/;

function childKind(title) {
  const t = title.trim();
  if (/^validators$/i.test(t)) return "roster";
  if (/^quorum requirement$/i.test(t)) return "quorum";
  return null;
}

export function extractBridges(allDocs, docById, docByDocNo, entityMap, edges, addEntity) {
  const nameIndex = buildNameIndex(entityMap);
  const stats = { roots: 0, validatorEdges: 0, created: 0, warnings: 0 };
  const warn = makeWarn("  bridge:", stats);

  // Group candidate children by parent doc_no (slot shape: { roster?, quorum? }).
  // Container docs also titled "Validators" ("The documents herein specify…")
  // never match ROSTER_RE, so they cannot complete a pair.
  const byParent = groupChildrenByParent(allDocs, (d) => childKind(d.title));

  for (const [parentDocNo, slot] of [...byParent.entries()].sort()) {
    if (!slot.roster || !slot.quorum) continue;
    const rosterMatch = (slot.roster.content ?? "").match(ROSTER_RE);
    const quorumMatch = (slot.quorum.content ?? "").match(QUORUM_RE);
    if (!rosterMatch && !quorumMatch) continue; // pair of containers / spec prose
    if (!rosterMatch || !quorumMatch) {
      warn(`pair at ${parentDocNo} only half-parsed (roster: ${!!rosterMatch}, quorum: ${!!quorumMatch})`);
      continue;
    }
    const root = docByDocNo.get(parentDocNo);
    if (!root) { warn(`no root doc for pair at ${parentDocNo}`); continue; }
    stats.roots++;

    const subject = rosterMatch[1].trim();
    const quorumSubject = quorumMatch[1].trim();
    if (normalizeKey(subject) !== normalizeKey(quorumSubject)) {
      warn(`subject mismatch at ${parentDocNo}: "${subject}" vs "${quorumSubject}"`);
    }
    const quorum = `${quorumMatch[2]}/${quorumMatch[3]}`;

    // Display name: the sentence subject collides across deployments
    // ("Governance Bridge" exists per network), so qualify from ancestry —
    // nearest ancestor titled "…Bridge" (SkyLink shape), else the root title
    // when it differs from the subject (SLL shape: root is the network doc),
    // agent-prefixed under the A.6.1.1.X subtree (like Pattern 17).
    let system = null;
    for (let dn = parentDocNo; dn.includes(".");) {
      dn = dn.split(".").slice(0, -1).join(".");
      const anc = docByDocNo.get(dn);
      if (anc && /bridge$/i.test(anc.title.trim()) && normalizeKey(anc.title) !== normalizeKey(subject)) {
        system = anc.title.trim();
        break;
      }
    }
    const network = normalizeKey(root.title) !== normalizeKey(subject) ? root.title.trim() : null;
    let displayName = subject;
    if (system) displayName = `${subject} (${system})`;
    else if (network) displayName = `${subject} (${network})`;
    const agentDoc = docByDocNo.get(root.doc_no.match(/^(A\.6\.1\.1\.\d+)\./)?.[1] ?? "");
    if (agentDoc) displayName = `${agentDoc.title} ${displayName}`;

    const slug = slugify(displayName);
    if (entityMap.has(slug)) { warn(`slug collision, skipped: ${root.doc_no} (${slug})`); continue; }

    const ent = addEntity(slug, displayName, "bridge", null, root.id, {
      source: "bridge_pattern",
      component: subject,
      network,
      quorum,
      quorum_doc_no: slot.quorum.doc_no,
    });
    ent.id = root.id; // doc UUID is the entity id, like instances and multisigs
    edges.push({
      fromId: root.id, fromType: "doc", toId: ent.id, toType: "entity",
      edgeType: "defines_entity", sourceDocNos: [],
    });

    const names = parseNameList(rosterMatch[2]);
    if (!names.length) warn(`roster yielded no names: ${slot.roster.doc_no}`);
    for (const name of names) {
      let v = nameIndex.get(normalizeKey(name));
      if (!v) {
        v = addEntity(slugify(name), name, "ecosystem_actor", "bridge_validator", null, {
          source: "bridge_validator",
          source_doc_no: slot.roster.doc_no,
        });
        nameIndex.set(normalizeKey(name), v);
        stats.created++;
      }
      edges.push({
        fromId: v.id, fromType: "entity", toId: ent.id, toType: "entity",
        edgeType: "validator_of", sourceDocNos: [slot.roster.doc_no],
      });
      stats.validatorEdges++;
    }
  }

  return stats;
}
