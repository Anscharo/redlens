// 2s-bis. process_step_responsible_party_for (Pattern 6, process step). Process-step
// "Update" docs (type Core, mostly A.2.2.9.*) carry the same bulleted "Responsible
// Party:" field as ADCs, but for per-step EXECUTION rather than governance data
// ownership, so it is a distinct edge type that never conflates with 2s. ADCs are
// skipped to avoid duplicating 2s. One edge per (doc, resolved entity, declared
// role): a repeated role collapses, but an Operational and a Core declaration on the
// same doc both stay even when they resolve to the same entity.
import { extractAllRP, extractAutomation } from "../graph-patterns.mjs";
import { warnDriftCount } from "../graph-tripwires.mjs";
import { resolveResponsibleParty } from "./resolve-responsible-party.mjs";

/** Emits this doc's edges; returns { edges, unresolved }. */
function emitForDoc(ctx, d, declarations) {
  const emitted = new Set();
  let unresolved = 0;
  for (const raw of declarations) {
    const { clean, automated } = extractAutomation(raw);
    const { entity, resolution, role } = resolveResponsibleParty(ctx, d, clean);
    if (!entity) {
      unresolved++;
      continue;
    }
    const key = `${entity.id}:${role ?? ""}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    const meta = JSON.stringify({ role_declared: raw, resolution, automated });
    ctx.addEdge(entity.id, "entity", d.id, "doc", "process_step_responsible_party_for", [d.doc_no], meta);
  }
  return { edges: emitted.size, unresolved };
}

function run(ctx) {
  let edges = 0;
  let docs = 0;
  let unresolved = 0;
  for (const d of ctx.allDocs.filter((doc) => doc.type !== "Active Data Controller")) {
    const declarations = extractAllRP(d.content);
    if (!declarations.length) continue;
    docs++;
    const r = emitForDoc(ctx, d, declarations);
    edges += r.edges;
    unresolved += r.unresolved;
  }
  console.log(`  process_step_responsible_party_for: ${edges} edges across ${docs} docs, ${unresolved} unresolved`);
  warnDriftCount("process_step_responsible_party_for unresolved", unresolved);
}

export const pattern = { id: "2s-bis", run };
