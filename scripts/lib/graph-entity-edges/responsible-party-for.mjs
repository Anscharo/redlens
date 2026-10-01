// 2s. responsible_party_for (Pattern 6): every Active Data Controller declares a
// Responsible Party (A.1.12.1.2). Resolution order is in resolve-responsible-party.mjs;
// edges carry meta.role_declared (the raw declaration) and meta.resolution.
import { extractRP } from "../graph-patterns.mjs";
import { warnDriftCount } from "../graph-tripwires.mjs";
import { resolveResponsibleParty } from "./resolve-responsible-party.mjs";

function run(ctx) {
  const counts = { direct: 0, chain: 0, role: 0, unresolved: 0 };
  for (const d of ctx.allDocs.filter((doc) => doc.type === "Active Data Controller")) {
    const raw = extractRP(d.content);
    const { entity, resolution } = raw ? resolveResponsibleParty(ctx, d, raw) : {};
    if (!entity) {
      counts.unresolved++;
      continue;
    }
    const meta = JSON.stringify({ role_declared: raw, resolution });
    ctx.addEdge(entity.id, "entity", d.id, "doc", "responsible_party_for", [d.doc_no], meta);
    counts[resolution === "direct" || resolution === "chain" ? resolution : "role"]++;
  }
  console.log(
    `  responsible_party_for: ${counts.direct} direct, ${counts.chain} via chain, ${counts.role} via role-binding, ${counts.unresolved} unresolved`,
  );
  warnDriftCount("responsible_party_for unresolved", counts.unresolved);
}

export const pattern = { id: "2s", run };
