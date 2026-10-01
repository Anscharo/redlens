// Resolves a raw "Responsible Party" declaration to an entity. Shared by 2s
// (ADC governance-level RP) and 2s-bis (process-step execution RP): same
// declaration shapes, same priority:
//   role   — names a role-binding doc's title (holds_role_for); wins over stub
//            entities 1f/1g may have created for the same words
//   direct — names an existing entity ("…is Soter Labs.")
//   chain  — names a role; walk Prime Agent → Executor Agent → role edge
import { rpRoleAndName, isDescriptiveRP } from "../graph-patterns.mjs";
import { inAgentArtifact, artifactExecId } from "./role-index.mjs";

function roleTitleHolder(ctx, name) {
  const needle = name.toLowerCase();
  for (const [title, holderId] of ctx.roles.roleHolderByDocTitle) {
    if (title !== needle && !title.includes(needle)) continue;
    const entity = ctx.entityById.get(holderId);
    if (entity) return entity;
  }
  return null;
}

function chainHolder(ctx, d, role) {
  const { roles, entityById } = ctx;
  if (role === "core_facilitator") return entityById.get(roles.coreFacId);
  if (role === "core_govops") return entityById.get(roles.coreGovId);
  if (inAgentArtifact(d)) {
    const execId = artifactExecId(ctx, d);
    if (!execId) return null;
    if (role === "operational_govops") return entityById.get(roles.opGovByExec.get(execId));
    if (role === "operational_facilitator") return entityById.get(roles.opFacByExec.get(execId));
    return null;
  }
  if (role === "operational_govops" && roles.uniqueOpGovId) return entityById.get(roles.uniqueOpGovId);
  if (role === "operational_facilitator" && roles.uniqueOpFacId) return entityById.get(roles.uniqueOpFacId);
  if (role === "support_facilitators") return ctx.supportFacilitators;
  return null;
}

/** { entity, resolution: "role" | "direct" | "chain" | null, role } for declaration `raw` on doc `d`. */
export function resolveResponsibleParty(ctx, d, raw) {
  const { role, name: rawName } = rpRoleAndName(raw);
  // Descriptive phrases ("entity to which the registration pertains") are not
  // entity names, so they never resolve by title or directly (mirrors the 1f
  // skip in graph-entities.mjs) and count as unresolved.
  const name = rawName && isDescriptiveRP(rawName) ? null : rawName;
  const byRole = name ? roleTitleHolder(ctx, name) : null;
  if (byRole) return { entity: byRole, resolution: "role", role };
  const direct = name ? ctx.entityByName(name) : null;
  if (direct) return { entity: direct, resolution: "direct", role };
  const chained = role ? chainHolder(ctx, d, role) : null;
  if (chained) return { entity: chained, resolution: "chain", role };
  return { entity: null, resolution: null, role };
}
