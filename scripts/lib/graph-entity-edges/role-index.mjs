// Who holds which acting role, read back from the role-assignment edges (2j–2o).
// Registered as its own step after 2r, so 2s / 2s-bis / 2s-ter all see the same
// index; it reads only role edges, which no later pattern emits.

const ARTIFACT_RE = /^A\.6\.1\.1\.(\d+)\./;

const unique = (ids) => {
  const set = [...new Set(ids)];
  return { ids: set, only: set.length === 1 ? set[0] : null };
};

function edgeMaps(ctx) {
  const opExecByPrime = new Map();
  const opFacByExec = new Map();
  const opGovByExec = new Map();
  const roleHolderByDocTitle = new Map(); // normalized title → holder entity id
  for (const e of ctx.edges) {
    if (e.edgeType === "operational_executor_agent_for") opExecByPrime.set(e.toId, e.fromId);
    else if (e.edgeType === "operational_facilitator_for") opFacByExec.set(e.toId, e.fromId);
    else if (e.edgeType === "operational_govops_for") opGovByExec.set(e.toId, e.fromId);
    else if (e.edgeType === "holds_role_for") {
      const title = ctx.docById.get(e.toId)?.title;
      if (title) roleHolderByDocTitle.set(title.toLowerCase(), e.fromId);
    }
  }
  return { opExecByPrime, opFacByExec, opGovByExec, roleHolderByDocTitle };
}

function run(ctx) {
  const maps = edgeMaps(ctx);
  const firstOf = (type) => ctx.edges.find((e) => e.edgeType === type);
  // Unique operational holders are the fallback for docs that declare a role
  // outside any Prime Agent context (e.g. Support Scope primitives). They resolve
  // only when exactly ONE org holds the role atlas-wide; otherwise they stay
  // unresolved rather than guessed.
  const opGov = unique(maps.opGovByExec.values());
  const opFac = unique(maps.opFacByExec.values());
  const opExec = unique(maps.opExecByPrime.values());
  ctx.roles = {
    ...maps,
    // Core Facilitator / GovOps resolve to a single entity across the atlas.
    coreFacId: firstOf("core_facilitator_for")?.fromId ?? null,
    coreGovId: firstOf("core_govops_for")?.fromId ?? null,
    // The core executor has no executor edge of its own; it is the target of core_govops_for.
    coreExecId: firstOf("core_govops_for")?.toId ?? null,
    uniqueOpGovIds: opGov.ids,
    uniqueOpGovId: opGov.only,
    uniqueOpFacIds: opFac.ids,
    uniqueOpFacId: opFac.only,
    uniqueOpExecIds: opExec.ids,
    uniqueOpExecId: opExec.only,
  };
}

// fragile: doc_no prefix. It extracts the agent-artifact index, not just a scope
// check, so a UUID-ancestor migration would have to carry that index separately.
export const inAgentArtifact = (d) => ARTIFACT_RE.test(d.doc_no);

/** The operational executor for the agent artifact `d` lives under, or null. */
export function artifactExecId(ctx, d) {
  const m = d.doc_no.match(ARTIFACT_RE);
  if (!m) return null;
  const primeEntity = ctx.entityByDocId.get(ctx.docByDocNo.get(`A.6.1.1.${m[1]}`)?.id);
  return primeEntity ? (ctx.roles.opExecByPrime.get(primeEntity.id) ?? null) : null;
}

export const pattern = { id: "role-index", run };
