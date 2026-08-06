// Tests for the Radar actor-profile data-shaping logic.
// Reads the built artifacts in /public — run `pnpm build:index && pnpm build:graph` first if stale.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode, GraphEntity, RelationEdge } from "../types";
import type { GraphData } from "./graphData";
import { buildSidebarActors, buildActorProfile } from "./actorIndex";
import { buildChainMap, buildActiveDataRows, type ActiveDataRow } from "./activeDataIndex";
import { buildRewardsIndex } from "./rewardsIndex";
import { EXEC_EDGES, FAC_EDGES, CHAIN_EDGES } from "./roleEdges";

const ROOT = path.resolve(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");

type Relations = { entities: GraphEntity[]; edges: RelationEdge[] };

const relations: Relations = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8"),
);
const docs: Record<string, AtlasNode> = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8"),
).nodes;

const graph: GraphData = {
  participants: relations.entities.filter(
    (e) => e.et !== "instance" && e.et !== "invocation" && e.et !== "primitive",
  ),
  instances: relations.entities.filter((e) => e.et === "instance"),
  invocations: relations.entities.filter((e) => e.et === "invocation"),
  primitives: relations.entities.filter((e) => e.et === "primitive"),
  edges: relations.edges,
};

const entityById = new Map(graph.participants.map((e) => [e.id, e]));
const rewardsIndex = buildRewardsIndex(docs, graph);
const allActiveDataRows = buildActiveDataRows(docs, graph);

const profile = (slug: string) =>
  buildActorProfile(slug, graph, docs, rewardsIndex, allActiveDataRows);

describe("buildSidebarActors", () => {
  const groups = buildSidebarActors(graph, docs);

  it("groups match the four role predicates over participants", () => {
    const primes = graph.participants.filter((e) => e.et === "agent" && e.st === "prime");
    const execs = graph.participants.filter(
      (e) => e.et === "agent" && e.st !== "prime" && e.st !== null,
    );
    const facs = graph.participants.filter((e) => e.et === "facilitator_org");
    const govs = graph.participants.filter((e) => e.et === "govops_org");

    const byLabel = new Map(groups.map((g) => [g.label, g.actors]));
    expect((byLabel.get("Prime Agents") ?? []).map((a) => a.id).sort()).toEqual(
      primes.map((e) => e.id).sort(),
    );
    expect((byLabel.get("Executor Agents") ?? []).map((a) => a.id).sort()).toEqual(
      execs.map((e) => e.id).sort(),
    );
    expect((byLabel.get("Facilitators") ?? []).map((a) => a.id).sort()).toEqual(
      facs.map((e) => e.id).sort(),
    );
    expect((byLabel.get("GovOps") ?? []).map((a) => a.id).sort()).toEqual(
      govs.map((e) => e.id).sort(),
    );
  });

  it("emits groups in a fixed role order and omits any role with zero members", () => {
    const labels = groups.map((g) => g.label);
    expect(labels).toEqual([...labels].filter((l, i) => labels.indexOf(l) === i));
    for (const g of groups) expect(g.actors.length).toBeGreaterThan(0);
    expect(["Prime Agents", "Executor Agents", "Facilitators", "GovOps"]).toEqual(
      expect.arrayContaining(labels),
    );
  });

  it("sorts each group by defining-doc doc_no, numeric", () => {
    for (const g of groups) {
      const docNos = g.actors.map((a) => (a.docId ? (docs[a.docId]?.doc_no ?? "") : ""));
      const sorted = [...docNos].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      expect(docNos).toEqual(sorted);
    }
  });

  it("every actor row carries its source entity's id/slug/name/et/st", () => {
    for (const g of groups) {
      for (const a of g.actors) {
        const src = entityById.get(a.id)!;
        expect(a).toEqual({ id: src.id, slug: src.slug, name: src.name, et: src.et, st: src.st, docId: src.did });
      }
    }
  });
});

describe("buildActorProfile — unknown slug", () => {
  it("returns null", () => {
    expect(profile("not-a-real-slug-in-this-atlas-xyz")).toBeNull();
  });
});

describe("buildActorProfile — prime agent branch", () => {
  const primes = graph.participants.filter((e) => e.et === "agent" && e.st === "prime");
  const chainMap = buildChainMap(graph.participants, graph.edges, docs, entityById);

  it("chain.primes is exactly [self]; executor/facilitator/govops ids agree with buildChainMap", () => {
    expect(primes.length).toBeGreaterThan(0);
    for (const prime of primes) {
      const p = profile(prime.slug)!;
      expect(p.chain.primes.map((n) => n.id)).toEqual([prime.id]);
      const expected = chainMap.get(prime.name);
      if (expected?.executorId) expect(p.chain.executors.map((n) => n.id)).toContain(expected.executorId);
      if (expected?.facilitatorId)
        expect(p.chain.facilitators.map((n) => n.id)).toContain(expected.facilitatorId);
      if (expected?.govopsId) expect(p.chain.govops.map((n) => n.id)).toContain(expected.govopsId);
    }
  });

  it("adRows only include rows tied to this agent by RP, facilitator, or agent name — and are deduped", () => {
    for (const prime of primes) {
      const p = profile(prime.slug)!;
      for (const r of p.adRows) {
        const hit =
          r.responsibleParty?.id === prime.id ||
          r.facilitator?.id === prime.id ||
          r.agent === prime.name;
        expect(hit).toBe(true);
      }
      expect(new Set(p.adRows.map((r) => r.activeDataId)).size).toBe(p.adRows.length);
    }
  });

  it("rewardsAgent, when resolved, points back at this same entity", () => {
    for (const prime of primes) {
      const p = profile(prime.slug)!;
      if (p.rewardsAgent) expect(p.rewardsAgent.agentEntity?.id).toBe(prime.id);
    }
  });

  it("instances/invocations are drawn only from this agent's defining doc, root-edit excluded", () => {
    const withInstances = primes.find((p) => profile(p.slug)!.instances.length > 0);
    expect(withInstances).toBeDefined();
    const p = profile(withInstances!.slug)!;
    for (const inst of p.instances) expect(inst.st).not.toBe("root-edit");
    for (const invo of p.invocations) expect(invo.st).not.toBe("root-edit");
  });

  it("instance signalParams never carry a blacklisted param key", () => {
    for (const prime of primes) {
      const p = profile(prime.slug)!;
      for (const inst of [...p.instances, ...p.invocations]) {
        for (const sp of inst.signalParams) {
          expect(["Tracking Methodology", "Operational Executor Agent"]).not.toContain(sp.key);
        }
      }
    }
  });

  it("primitives are non-empty and sorted by categoryOrder (then doc_no within a category)", () => {
    const withPrimitives = primes.find((p) => profile(p.slug)!.primitives.length > 1);
    expect(withPrimitives).toBeDefined();
    const p = profile(withPrimitives!.slug)!;
    for (let i = 1; i < p.primitives.length; i++) {
      expect(p.primitives[i].categoryOrder).toBeGreaterThanOrEqual(p.primitives[i - 1].categoryOrder);
    }
  });
});

describe("buildActorProfile — executor agent branch", () => {
  it("chain.executors is [self]; primes come from this executor's EXEC_EDGES targets", () => {
    const execs = graph.participants.filter(
      (e) => e.et === "agent" && e.st !== "prime" && e.st !== null,
    );
    expect(execs.length).toBeGreaterThan(0);
    for (const exec of execs) {
      const p = profile(exec.slug)!;
      expect(p.chain.executors.map((n) => n.id)).toEqual([exec.id]);
      const expectedPrimeIds = new Set(
        graph.edges.filter((e) => EXEC_EDGES.has(e.e) && e.f === exec.id).map((e) => e.t),
      );
      expect(new Set(p.chain.primes.map((n) => n.id))).toEqual(expectedPrimeIds);
    }
  });
});

describe("buildActorProfile — facilitator_org branch", () => {
  it("chain.executors mirror this facilitator's FAC_EDGES targets", () => {
    const facs = graph.participants.filter((e) => e.et === "facilitator_org");
    expect(facs.length).toBeGreaterThan(0);
    for (const fac of facs) {
      const p = profile(fac.slug)!;
      const facEdges = graph.edges.filter((e) => FAC_EDGES.has(e.e) && e.f === fac.id);
      expect(new Set(p.chain.executors.map((n) => n.id))).toEqual(new Set(facEdges.map((e) => e.t)));
    }
  });
});

describe("buildActorProfile — governance-edge recommendation", () => {
  it("recommends once per relation whose other end is a governance_body or composite_party", () => {
    const candidate = graph.participants.find((e) => {
      const p = profile(e.slug);
      return p?.relations.some((r) => r.otherEt === "governance_body" || r.otherEt === "composite_party");
    });
    expect(candidate).toBeDefined();
    const p = profile(candidate!.slug)!;
    const govRelCount = p.relations.filter(
      (r) => r.otherEt === "governance_body" || r.otherEt === "composite_party",
    ).length;
    const govRecCount = p.recommendations.filter((r) => r.kind === "governance-edge").length;
    expect(govRecCount).toBe(govRelCount);
    expect(govRecCount).toBeGreaterThan(0);
  });

  it("relations never surface chain edges, comprises/member_of/cites/cited_by, or the entity itself", () => {
    for (const entity of graph.participants.slice(0, 15)) {
      const p = profile(entity.slug)!;
      for (const r of p.relations) {
        expect(CHAIN_EDGES.has(r.edge.e)).toBe(false);
        expect(["comprises", "member_of", "cites", "cited_by"]).not.toContain(r.edge.e);
        expect(r.otherId).not.toBe(entity.id);
      }
    }
  });
});

describe("buildActorProfile — composite party membership", () => {
  it("comprisesMembers mirrors this composite party's outgoing comprises edges", () => {
    const composite = graph.participants.find(
      (e) => e.et === "composite_party" && graph.edges.some((ed) => ed.e === "comprises" && ed.f === e.id),
    );
    expect(composite).toBeDefined();
    const p = profile(composite!.slug)!;
    const expectedMemberIds = graph.edges
      .filter((e) => e.e === "comprises" && e.f === composite!.id && e.tt === "entity")
      .map((e) => e.t);
    expect(p.comprisesMembers.length).toBe(expectedMemberIds.length);
    expect(p.comprisesMembers.map((m) => m.name).sort()).toEqual(
      expectedMemberIds.map((id) => entityById.get(id)?.name ?? id.slice(0, 8)).sort(),
    );
  });

  it("partOfComposite is set for a member entity, naming the composite party that comprises it", () => {
    const memberEdge = graph.edges.find((e) => e.e === "comprises" && e.ft === "entity" && e.tt === "entity");
    expect(memberEdge).toBeDefined();
    const member = entityById.get(memberEdge!.t)!;
    const composite = entityById.get(memberEdge!.f)!;
    const p = profile(member.slug)!;
    expect(p.partOfComposite).toEqual({ name: composite.name, slug: composite.slug ?? null });
  });

  it("partOfComposite is null for an entity that is not a composite member", () => {
    const memberIds = new Set(graph.edges.filter((e) => e.e === "comprises").map((e) => e.t));
    const nonMember = graph.participants.find((e) => e.et === "govops_org" && !memberIds.has(e.id));
    expect(nonMember).toBeDefined();
    expect(profile(nonMember!.slug)!.partOfComposite).toBeNull();
  });
});

describe("buildActorProfile — contact channels", () => {
  it("channels sort forum before discord; emergency sorts ecosystem before agent_specific", () => {
    const withBoth = graph.participants.find((e) => {
      const p = profile(e.slug);
      const platforms = new Set(p?.contact.channels.map((c) => c.platform));
      return platforms.has("forum") && platforms.has("discord");
    });
    expect(withBoth).toBeDefined();
    const p = profile(withBoth!.slug)!;
    const platforms = p.contact.channels.map((c) => c.platform);
    expect(platforms.indexOf("forum")).toBeLessThan(platforms.indexOf("discord"));

    const withBothScopes = graph.participants.find((e) => {
      const p = profile(e.slug);
      const scopes = new Set(p?.contact.emergency.map((c) => c.scope));
      return scopes.has("ecosystem") && scopes.has("agent_specific");
    });
    expect(withBothScopes).toBeDefined();
    const pe = profile(withBothScopes!.slug)!;
    const scopes = pe.contact.emergency.map((c) => c.scope);
    expect(scopes.indexOf("ecosystem")).toBeLessThan(scopes.indexOf("agent_specific"));
  });

  it("is empty for an entity with no governance_channel/emergency_response edges", () => {
    const noContact = graph.participants.find((e) => e.et === "facilitator_org");
    expect(noContact).toBeDefined();
    const p = profile(noContact!.slug)!;
    expect(p.contact.channels).toEqual([]);
    expect(p.contact.emergency).toEqual([]);
  });
});

// The following branches are not reachable from the current atlas content
// (every real facilitator_org/govops_org resolves at least one executor, and
// every real prime agent already has both a resolved RP and a rewards
// primitive), so they're exercised against a small hand-built graph instead.
describe("buildActorProfile — synthetic: zero-exec fallback, missing RP, no rewards", () => {
  const primeDoc: AtlasNode = {
    id: "syn-prime-doc", doc_no: "Z.1", title: "PrimeX", type: "Core",
    depth: 3, parentId: null, content: "", order: 0, addressRefs: [],
  };
  const facDoc: AtlasNode = {
    id: "syn-fac-doc", doc_no: "Z.2", title: "FacNoExec", type: "Core",
    depth: 3, parentId: null, content: "", order: 0, addressRefs: [],
  };
  const synDocs: Record<string, AtlasNode> = { [primeDoc.id]: primeDoc, [facDoc.id]: facDoc };

  const primeEntity: GraphEntity = {
    id: "syn-prime-doc", slug: "primex", name: "PrimeX", et: "agent", st: "prime", did: "syn-prime-doc",
  };
  const facEntity: GraphEntity = {
    id: "syn-fac-no-exec", slug: "facnoexec", name: "FacNoExec", et: "facilitator_org", st: null, did: "syn-fac-doc",
  };
  const synGraph: GraphData = {
    participants: [primeEntity, facEntity],
    instances: [],
    invocations: [],
    primitives: [],
    edges: [],
  };

  const blankRow = (over: Partial<ActiveDataRow>): ActiveDataRow => ({
    activeDataId: "ad1", activeDataDocNo: "Z.1.1", activeDataTitle: "Test AD",
    controllerId: null, controllerDocNo: null, controllerTitle: null,
    agent: null, chain: null, responsibleParty: null, declaredRP: null,
    facilitator: null, process: "Direct Edit", sourceDocNo: null,
    ...over,
  });

  it("flags missing-rp and no-rewards for a prime agent with an unresolved RP and no rewards primitive", () => {
    const rows = [blankRow({ agent: "PrimeX", responsibleParty: null })];
    const p = buildActorProfile("primex", synGraph, synDocs, { agents: [] }, rows)!;
    expect(p.recommendations.map((r) => r.kind).sort()).toEqual(["missing-rp", "no-rewards"]);
  });

  it("does not flag missing-rp once the row has a resolved responsible party", () => {
    const rows = [
      blankRow({
        agent: "PrimeX",
        responsibleParty: { name: "X", id: "x1", docId: null, resolution: "direct", declared: null, evidence: [] },
      }),
    ];
    const p = buildActorProfile("primex", synGraph, synDocs, { agents: [] }, rows)!;
    expect(p.recommendations.map((r) => r.kind)).toEqual(["no-rewards"]);
  });

  it("facilitator_org with zero FAC_EDGES falls back to itself as facilitator, with empty executors/primes/govops", () => {
    const p = buildActorProfile("facnoexec", synGraph, synDocs, { agents: [] }, [])!;
    expect(p.chain).toEqual({
      primes: [],
      executors: [],
      facilitators: [{ id: "syn-fac-no-exec", slug: "facnoexec", name: "FacNoExec", et: "facilitator_org", st: null, docId: "syn-fac-doc" }],
      govops: [],
    });
  });
});
