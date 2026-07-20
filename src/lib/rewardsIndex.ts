import type { AtlasNode, RelationEdge, GraphEntity } from "../types";
import { agentsFromGraph, type AgentRef } from "./activeDataIndex";
import { parseMeta } from "./meta";
import { toCSV } from "./csv";
import type { GraphData } from "./graphData";
import type {
  AgentPrimitive,
  EntityRef,
  InstanceMeta,
  InstanceStatus,
  InvocationMeta,
  InvocationStatus,
  OperationalChain,
  ParamTuple,
  PrimitiveKind,
  RewardsAgent,
  RewardsEcosystemNode,
  RewardsIcd,
  RewardsIndex,
  RewardsInstance,
  RewardsInvocation,
} from "./rewardsTypes";

export * from "./rewardsTypes";

const plain = (n: AtlasNode | undefined) => (n?.content ?? "").trim();
const unwrapBackticks = (s: string) => s.match(/^`([^`\n]+)`\.?$/)?.[1] ?? s;
const UUID_LINK_RE = /\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/;

interface GraphCtx {
  paymentControllerByInstance: Map<string, AtlasNode>; // keyed by ICD doc_no
  rpByDocId: Map<string, EntityRef>;
  entityById: Map<string, GraphEntity>;
  edges: RelationEdge[];
  instanceEntities: GraphEntity[];
  instanceMetaById: Map<string, InstanceMeta>;
  invocationEntities: GraphEntity[];
  invocationMetaById: Map<string, InvocationMeta>;
}

function buildGraphCtx(byDocNo: Map<string, AtlasNode>, graph?: GraphData): GraphCtx {
  // Build a UUID → doc index so we can look up active_data_for edge targets.
  const docById = new Map<string, AtlasNode>();
  for (const d of byDocNo.values()) docById.set(d.id, d);

  // Locate each DR Payment Active Data Controller via active_data_for graph
  // edges. Edge direction: doc(*.0.6.1 "List Of Payments") → doc(controller).
  // Stripping the last 2 segments of the controller's doc_no yields the ICD
  // doc_no (works for active/completed ".3.4" and in-progress ".4.4" tiers).
  // fragile: doc_no prefix — ".3.4"/".4.4" are NOT spec-defined structural
  // suffixes (only .0.3.X/.0.4.X/.1.X/.varX/.0.6.X/NR-X are); this is editorial
  // ICD-tier numbering that could renumber. Migrate to UUID-based parent_of
  // traversal when convenient.
  const paymentControllerByInstance = new Map<string, AtlasNode>();
  for (const e of graph?.edges ?? []) {
    if (e.e !== "active_data_for") continue;
    const controller = docById.get(e.t);
    if (!controller || controller.title !== "Distribution Reward Payments") continue;
    const parts = controller.doc_no.split(".");
    if (parts.length > 2) paymentControllerByInstance.set(parts.slice(0, -2).join("."), controller);
  }
  const allEntities = [
    ...(graph?.participants ?? []),
    ...(graph?.instances ?? []),
    ...(graph?.invocations ?? []),
  ];
  const entityById = new Map<string, GraphEntity>(allEntities.map((e) => [e.id, e]));
  const rpByDocId = new Map<string, EntityRef>();
  for (const e of graph?.edges ?? []) {
    if (e.e !== "responsible_party_for") continue;
    const ent = entityById.get(e.f);
    if (ent) rpByDocId.set(e.t, { id: ent.id, name: ent.name, slug: ent.slug });
  }
  const instanceEntities: GraphEntity[] = [];
  const instanceMetaById = new Map<string, InstanceMeta>();
  for (const ent of graph?.instances ?? []) {
    const m = parseMeta<InstanceMeta>(ent.m);
    if (!m) continue;
    instanceEntities.push(ent);
    instanceMetaById.set(ent.id, {
      agent_doc_id: m.agent_doc_id ?? null,
      primitive_category_doc_id: m.primitive_category_doc_id ?? null,
      status: m.status ?? null,
      params: m.params ?? {},
    });
  }
  const invocationEntities: GraphEntity[] = [];
  const invocationMetaById = new Map<string, InvocationMeta>();
  for (const ent of graph?.invocations ?? []) {
    const m = parseMeta<InvocationMeta>(ent.m);
    if (!m) continue;
    invocationEntities.push(ent);
    invocationMetaById.set(ent.id, {
      agent_doc_id: m.agent_doc_id ?? null,
      primitive_category_doc_id: m.primitive_category_doc_id ?? null,
      status: m.status ?? null,
      params: m.params ?? {},
    });
  }
  return {
    paymentControllerByInstance,
    rpByDocId,
    entityById,
    edges: graph?.edges ?? [],
    instanceEntities,
    instanceMetaById,
    invocationEntities,
    invocationMetaById,
  };
}

function resolveChain(ctx: GraphCtx, primeId: string): OperationalChain | null {
  const execEdge = ctx.edges.find(
    (e) => e.e === "operational_executor_agent_for" && e.t === primeId,
  );
  const exec = execEdge ? ctx.entityById.get(execEdge.f) : null;
  const govEdge = exec
    ? ctx.edges.find((e) => e.e === "operational_govops_for" && e.t === exec.id)
    : null;
  const gov = govEdge ? ctx.entityById.get(govEdge.f) : null;
  if (!exec && !gov) return null;
  return {
    executor: exec ? { id: exec.id, name: exec.name, slug: exec.slug } : null,
    govops: gov ? { id: gov.id, name: gov.name, slug: gov.slug } : null,
  };
}

function applyParamTuples<S>(
  inst: RewardsIcd<S>,
  params: Record<string, ParamTuple>,
  kind: PrimitiveKind,
  docs: Record<string, AtlasNode>,
): void {
  const take = (key: string): [string, string, string] | null => {
    const t = params[key];
    return t && t[0] ? t : null;
  };
  if (kind === "DR") {
    const rc = take("Reward Code");
    if (rc) {
      inst.rewardCode = rc[0];
      inst.rewardCodeDocId = rc[1];
    }
    const tr = take("Tracking Methodology");
    if (tr) {
      inst.tracking = tr[0];
      const rawContent = docs[tr[1]]?.content ?? "";
      const linkedId = rawContent.match(UUID_LINK_RE)?.[1];
      const target = linkedId ? docs[linkedId] : null;
      inst.trackingDocId = target?.id ?? tr[1];
      inst.trackingDocNo = target?.doc_no ?? tr[2];
    }
  } else {
    const pn = take("Integration Partner Name");
    if (pn) {
      inst.partnerName = pn[0];
      inst.partnerNameDocId = pn[1];
    }
    const ra = take("Integration Partner Reward Address");
    if (ra) inst.rewardAddress = ra[0];
    const ch = take("Integration Partner Chain");
    if (ch) {
      inst.rewardChain = ch[0];
      inst.rewardChainDocId = ch[1];
    }
    const cd = take("Integration Boost Cadence");
    if (cd) {
      inst.cadence = cd[0];
      inst.cadenceDocId = cd[1];
    }
  }
}

function extractIcdFromEntity<S>(
  ent: GraphEntity,
  meta: { params: Record<string, ParamTuple> },
  status: S,
  kind: PrimitiveKind,
  ctx: GraphCtx,
  docs: Record<string, AtlasNode>,
): RewardsIcd<S> {
  const icdDoc = ent.did ? docs[ent.did] : null;
  const inst: RewardsIcd<S> = { id: ent.id, docNo: icdDoc?.doc_no ?? "", name: ent.name, status };
  applyParamTuples(inst, meta.params, kind, docs);
  if (Object.keys(meta.params).length > 0) inst.params = meta.params;
  if (kind === "DR" && inst.docNo) {
    const controller = ctx.paymentControllerByInstance.get(inst.docNo);
    if (controller) {
      inst.paymentsControllerId = controller.id;
      inst.paymentsControllerDocNo = controller.doc_no;
      inst.paymentsResponsibleParty = ctx.rpByDocId.get(controller.id) ?? undefined;
    }
  }
  return inst;
}

function extractPrimitive(
  byDocNo: Map<string, AtlasNode>,
  docs: Record<string, AtlasNode>,
  ctx: GraphCtx,
  agent: AgentRef,
  kind: PrimitiveKind,
): AgentPrimitive | null {
  // fragile: doc_no prefix — ".2.5.1"/".2.5.2" (DR/Integration Boost primitives)
  // are editorial ICD-tier numbering, not a spec-defined structural suffix;
  // built by string concatenation off the agent's own (also arithmetic) doc_no.
  const primitiveDocNo = `${agent.docNo}.2.5.${kind === "DR" ? "1" : "2"}`;
  const head = byDocNo.get(primitiveDocNo);
  if (!head) return null;
  const globalActivation = unwrapBackticks(plain(byDocNo.get(`${primitiveDocNo}.1.1`))) || null;
  const primSlug = kind === "DR" ? "distribution-reward" : "integration-boost";

  const instances = ctx.instanceEntities.filter(
    (e) => e.st === primSlug && ctx.instanceMetaById.get(e.id)?.agent_doc_id === agent.docId,
  );
  const instanceBuckets: Record<InstanceStatus, RewardsInstance[]> = {
    Active: [],
    Suspended: [],
    Completed: [],
  };
  for (const ent of instances) {
    const meta = ctx.instanceMetaById.get(ent.id)!;
    // status fallback to Active preserves the report's prior behavior of
    // surfacing instances whose atlas-side status is missing/unparseable.
    const status: InstanceStatus =
      meta.status === "Suspended" ? "Suspended"
        : meta.status === "Completed" ? "Completed"
          : "Active";
    instanceBuckets[status].push(
      extractIcdFromEntity<InstanceStatus>(ent, meta, status, kind, ctx, docs),
    );
  }

  const invocations: RewardsInvocation[] = ctx.invocationEntities
    .filter((e) => e.st === primSlug && ctx.invocationMetaById.get(e.id)?.agent_doc_id === agent.docId)
    .map((ent) => {
      const meta = ctx.invocationMetaById.get(ent.id)!;
      return extractIcdFromEntity<InvocationStatus>(ent, meta, "InProgress", kind, ctx, docs);
    });

  return {
    kind,
    primitiveId: head.id,
    primitiveDocNo,
    globalActivation,
    active: instanceBuckets.Active,
    suspended: instanceBuckets.Suspended,
    completed: instanceBuckets.Completed,
    invocations,
  };
}

export function buildRewardsIndex(
  docs: Record<string, AtlasNode>,
  graph?: GraphData,
): RewardsIndex {
  const byDocNo = new Map<string, AtlasNode>();
  for (const n of Object.values(docs)) byDocNo.set(n.doc_no, n);
  const ctx = buildGraphCtx(byDocNo, graph);

  const refs: AgentRef[] = graph ? agentsFromGraph(graph.participants, docs) : [];
  const agents: RewardsAgent[] = refs.map((ref) => {
    const ae: EntityRef = {
      id: ref.id,
      name: ref.name,
      slug: (graph?.participants ?? []).find((e) => e.id === ref.id)?.slug ?? "",
    };
    return {
      name: ref.name,
      docNoPrefix: ref.docNoPrefix,
      agentEntity: ae,
      chain: resolveChain(ctx, ae.id),
      dr: extractPrimitive(byDocNo, docs, ctx, ref, "DR"),
      ib: extractPrimitive(byDocNo, docs, ctx, ref, "IB"),
    };
  });

  const eco = (id: string): RewardsEcosystemNode | null => {
    const n = docs[id];
    return n ? { id: n.id, docNo: n.doc_no, title: n.title, description: n.content.trim() } : null;
  };

  return {
    agents,
    stUsdsDr:    eco("673676d8-62a4-4422-b870-fbcdb3c0aabd"), // A.4.4.1.3.7
    srUsdsDr:    eco("626f0f67-1df9-41e8-a4a6-230aa1ccc824"), // A.3.2.2.4.2.4
    drPrimitive: eco("e632c38f-3e4e-4c7e-acfd-b6ec45a422e6"), // A.2.2.8.1 (Distribution Reward Primitive)
    ibPrimitive: eco("73577399-62e4-4a83-ae11-64ef7e7b7f20"), // A.2.2.8.2 (Integration Boost Primitive)
    demandSideBufferAddress: "0x5e2fec3a3c4e63a422e45c1bb83edb3a5ad0543b",
  };
}

// Flattens the reward index to one CSV row per Instance/Invocation across every
// agent's DR and IB primitives. Params are joined as "key=value; …" (display
// value only). Empty columns for fields that don't apply to the primitive kind.
function paramsToString(params?: Record<string, ParamTuple>): string {
  if (!params) return "";
  return Object.entries(params).map(([k, tup]) => `${k}=${tup[0]}`).join("; ");
}

export function rewardsIndexToCSV(idx: RewardsIndex): string {
  const rows: (string | number)[][] = [];
  for (const a of idx.agents) {
    const exec = a.chain?.executor?.name ?? "";
    const govops = a.chain?.govops?.name ?? "";
    for (const prim of [a.dr, a.ib]) {
      if (!prim) continue;
      const kindLabel = prim.kind === "DR" ? "Distribution Reward" : "Integration Boost";
      for (const icd of [...prim.active, ...prim.suspended, ...prim.completed, ...prim.invocations]) {
        rows.push([
          a.name, exec, govops, kindLabel, prim.primitiveDocNo, prim.globalActivation ?? "",
          icd.docNo, icd.name, icd.status,
          icd.rewardCode ?? "", icd.partnerName ?? "", icd.rewardAddress ?? "", icd.rewardChain ?? "",
          icd.cadence ?? "", icd.tracking ?? "",
          icd.paymentsControllerDocNo ?? "", icd.paymentsResponsibleParty?.name ?? "",
          paramsToString(icd.params),
        ]);
      }
    }
  }
  return toCSV(
    [
      "Agent", "Executor", "GovOps", "Primitive", "Primitive Doc", "Global Activation",
      "Doc No", "Name", "Status", "Reward Code", "Partner Name", "Reward Address",
      "Reward Chain", "Cadence", "Tracking", "Payments Controller Doc", "Responsible Party", "Params",
    ],
    rows,
  );
}
