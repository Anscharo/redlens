// 2j. {operational,core}_executor_agent_for (Pattern 3). Source: ICD parameter
// docs titled "Operational/Core Executor Agent" (A.6.1.1.X.2.Z.2.N.1.1.1), whose
// content cites the executor's defining doc. The Prime Agent is found by walking
// the parentId chain up from the parameter doc.
import { isPrimeAgent, isEcosystemAccord, UUID_LINK_RE } from "../graph-patterns.mjs";

const EXECUTOR_PARAM_RE = /^(operational|core)(?: council)? executor agent$/i;

function citedDocId(ctx, doc) {
  for (const m of (doc.content ?? "").matchAll(UUID_LINK_RE)) {
    if (ctx.docIds.has(m[2])) return m[2];
  }
  return null;
}

function ancestorPrimeAgent(ctx, doc) {
  let cur = doc;
  for (let i = 0; i < 20 && cur?.parentId; i++) {
    const parent = ctx.docById.get(cur.parentId);
    if (parent && isPrimeAgent(parent)) return parent;
    cur = parent;
  }
  return null;
}

/** Best-effort: the accord whose parties include this Prime Agent (by entity or by name). */
function accordFor(ctx, primeEntity) {
  return ctx.allDocs.find((a) => {
    if (!isEcosystemAccord(a)) return false;
    const partyDocs = ctx.accordPartyDocsByAccordDocNo.get(a.doc_no) ?? [];
    return partyDocs.some(
      (pd) => pd.partyEntity.id === primeEntity.id || (pd.memberStr ?? "").includes(primeEntity.name),
    );
  });
}

function run(ctx) {
  for (const paramDoc of ctx.allDocs.filter((d) => EXECUTOR_PARAM_RE.test(d.title))) {
    const executorDocId = citedDocId(ctx, paramDoc);
    const executorEntity = executorDocId ? ctx.entityByDocId.get(executorDocId) : null;
    if (!executorEntity) continue;
    const primeDoc = ancestorPrimeAgent(ctx, paramDoc);
    const primeEntity = primeDoc ? ctx.entityByDocId.get(primeDoc.id) : null;
    if (!primeEntity) continue;
    const accordDoc = accordFor(ctx, primeEntity);
    const sources = accordDoc ? [paramDoc.doc_no, accordDoc.doc_no] : [paramDoc.doc_no];
    const edgeType =
      executorEntity.subtype === "core_executor" ? "core_executor_agent_for" : "operational_executor_agent_for";
    ctx.addEdge(executorEntity.id, "entity", primeEntity.id, "entity", edgeType, sources);
  }
}

export const pattern = { id: "2j", run };
