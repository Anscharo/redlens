// Who a duty found by 2s-ter binds. Per acting role: the orgs that hold it (for
// name-attributed duties) and a resolver from a declared role label plus the doc
// it was found in to the holding entities.
import { DUTY_ROLES } from "../graph-duties.mjs";
import { artifactExecId } from "./role-index.mjs";

function roleContexts(roles) {
  return {
    govops: { coreId: roles.coreGovId, opByExec: roles.opGovByExec, opIds: roles.uniqueOpGovIds },
    facilitator: { coreId: roles.coreFacId, opByExec: roles.opFacByExec, opIds: roles.uniqueOpFacIds },
    // The artifact chain's target IS the executor, so there is no lookup map.
    executor: { coreId: roles.coreExecId, opByExec: null, opIds: roles.uniqueOpExecIds },
  };
}

/** { byRole, orgIdByName, orgsByRole } for the current role index. */
export function dutyHolders(ctx) {
  const byRole = roleContexts(ctx.roles);
  const orgIdByName = new Map();
  const orgsByRole = new Map();
  for (const role of DUTY_ROLES) {
    const holders = byRole[role.key];
    const orgs = [];
    const add = (entity, label) => {
      if (!entity) return;
      orgs.push({ name: entity.name, role_declared: label });
      orgIdByName.set(entity.name, entity.id);
    };
    for (const id of holders.opIds) add(ctx.entityById.get(id), role.op.label);
    add(ctx.entityById.get(holders.coreId), role.core.label);
    orgsByRole.set(role.key, orgs);
  }
  return { byRole, orgIdByName, orgsByRole };
}

// A duty that cannot be pinned to ONE holder binds EVERY holder. "Operational
// Facilitator must X" outside an agent artifact is a duty of each operational
// facilitator org in its own context, and a bare-label duty ("Facilitators must
// document…", the A.1.6 universal duties) also binds the core org. Fanning out
// keeps the duty instead of dropping it.
export function resolveDutyEntities(ctx, holders, role, d, duty) {
  const h = holders.byRole[role.key];
  const byIds = (ids) => ids.map((id) => ctx.entityById.get(id)).filter(Boolean);
  if (duty.orgName) return byIds([holders.orgIdByName.get(duty.orgName)]);
  if (duty.role_declared === role.core.label) return byIds([h.coreId]);
  const execId = artifactExecId(ctx, d);
  if (execId) return byIds([h.opByExec ? h.opByExec.get(execId) : execId]);
  if (duty.role_declared === role.op.label) return byIds(h.opIds);
  return byIds([...h.opIds, h.coreId]); // bare label: a universal duty
}
