// Graph snapshot tests — record the current state of relations.json so that
// atlas updates or code changes produce a reviewable diff rather than silently
// altering the graph.
//
// Run `pnpm build:graph` to rebuild artifacts, then:
//   pnpm test graph-snapshots          — check against saved snapshots
//   pnpm test graph-snapshots -u       — update snapshots after a deliberate change

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

type Entity = {
  id: string;
  slug: string;
  name: string;
  et: string;
  st: string | null;
  did: string | null;
  m?: string | null;
};
type Edge = {
  f: string;
  ft: string;
  t: string;
  tt: string;
  e: string;
  s?: string[];
  m?: string;
};
type AtlasNode = { id: string; doc_no: string; title: string; type: string; parentId: string | null; content: string };
type Relations = { entities: Entity[]; edges: Edge[] };

const relations: Relations = JSON.parse(fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8"));
const docs: Record<string, AtlasNode> = JSON.parse(fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8")).nodes;

const entityById = new Map(relations.entities.map((e) => [e.id, e]));

function label(id: string, type: string): string {
  if (type === "doc") return docs[id]?.doc_no ?? id;
  if (type === "entity") return entityById.get(id)?.name ?? id;
  return id;
}

function edgesOfType(et: string): Edge[] {
  return relations.edges.filter((e) => e.e === et);
}

// ---------------------------------------------------------------------------
// Entities by type
// ---------------------------------------------------------------------------

describe("entities", () => {
  it("prime agents", () => {
    const primes = relations.entities
      .filter((e) => e.et === "agent" && e.st === "prime")
      .map((e) => ({
        name: e.name,
        slug: e.slug,
        definingDoc: e.did ? docs[e.did]?.doc_no : null,
      }))
      .sort((a, b) => (a.definingDoc ?? "").localeCompare(b.definingDoc ?? ""));
    expect(primes).toMatchSnapshot();
  });

  it("executor agents", () => {
    const executors = relations.entities
      .filter((e) => e.et === "agent" && e.st !== "prime" && e.st !== null)
      .map((e) => {
        const primeEdge = edgesOfType("operational_executor_agent_for").find((ed) => ed.f === e.id)
          ?? edgesOfType("core_executor_agent_for").find((ed) => ed.f === e.id);
        const prime = primeEdge ? entityById.get(primeEdge.t) : null;
        return {
          name: e.name,
          slug: e.slug,
          subtype: e.st,
          definingDoc: e.did ? docs[e.did]?.doc_no : null,
          prime: prime?.name ?? null,
        };
      })
      .sort((a, b) => (a.definingDoc ?? "").localeCompare(b.definingDoc ?? ""));
    expect(executors).toMatchSnapshot();
  });

  it("facilitators", () => {
    const facs = relations.entities
      .filter((e) => e.et === "facilitator_org")
      .map((e) => ({ name: e.name, slug: e.slug }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(facs).toMatchSnapshot();
  });

  it("govops orgs", () => {
    const govops = relations.entities
      .filter((e) => e.et === "govops_org")
      .map((e) => ({ name: e.name, slug: e.slug }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(govops).toMatchSnapshot();
  });

  it("composite parties and their members", () => {
    const parties = relations.entities
      .filter((e) => e.et === "composite_party")
      .map((e) => ({
        name: e.name,
        members: edgesOfType("comprises")
          .filter((ed) => ed.f === e.id)
          .map((ed) => entityById.get(ed.t)?.name ?? ed.t)
          .sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(parties).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Edge types — counts + named pairs
// ---------------------------------------------------------------------------

describe("edge type counts", () => {
  it("all edge types and their counts", () => {
    const counts: Record<string, number> = {};
    for (const e of relations.edges) counts[e.e] = (counts[e.e] ?? 0) + 1;
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    expect(sorted).toMatchSnapshot();
  });
});

describe("role edges", () => {
  const ROLE_EDGES = [
    "prime_agent_for",
    "operational_executor_agent_for",
    "core_executor_agent_for",
    "operational_facilitator_for",
    "core_facilitator_for",
    "operational_govops_for",
    "core_govops_for",
  ];
  for (const et of ROLE_EDGES) {
    it(et, () => {
      const pairs = edgesOfType(et)
        .map((e) => `${label(e.f, e.ft)} → ${label(e.t, e.tt)}`)
        .sort();
      expect(pairs).toMatchSnapshot();
    });
  }
});

describe("governance edges", () => {
  it("responsible_party_for — entity → ADC doc", () => {
    const pairs = edgesOfType("responsible_party_for")
      .map((e) => ({
        party: label(e.f, e.ft),
        adc: label(e.t, e.tt),
        declared: e.m ? (JSON.parse(e.m).role_declared ?? null) : null,
      }))
      .sort((a, b) => a.adc.localeCompare(b.adc));
    expect(pairs).toMatchSnapshot();
  });

  it("active_data_for — AD doc → ADC doc", () => {
    const pairs = edgesOfType("active_data_for")
      .map((e) => `${label(e.f, e.ft)} → ${label(e.t, e.tt)}`)
      .sort();
    expect(pairs).toMatchSnapshot();
  });

  it("ecosystem_accord — accord doc → party entity", () => {
    const pairs = edgesOfType("ecosystem_accord")
      .map((e) => `${label(e.f, e.ft)} → ${label(e.t, e.tt)}`)
      .sort();
    expect(pairs).toMatchSnapshot();
  });

  it("aligned_delegate_for", () => {
    const pairs = edgesOfType("aligned_delegate_for")
      .map((e) => `${label(e.f, e.ft)} → ${label(e.t, e.tt)}`)
      .sort();
    expect(pairs).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Instances — per prime agent, per type, with params
// ---------------------------------------------------------------------------

describe("instances", () => {
  it("instance counts by type", () => {
    const counts: Record<string, number> = {};
    for (const e of relations.entities.filter((e) => e.et === "instance")) {
      counts[e.st ?? "unknown"] = (counts[e.st ?? "unknown"] ?? 0) + 1;
    }
    expect(Object.fromEntries(Object.entries(counts).sort())).toMatchSnapshot();
  });

  // One snapshot per instance type for readability
  const INSTANCE_TYPES = [
    "agent-token",
    "executor-accord",
    "distribution-requirement",
    "distribution-reward",
    "integration-boost",
    "upkeep-rebate",
    "allocation-system",
    "pioneer-chain",
    "core-governance-reward",
  ];

  for (const instType of INSTANCE_TYPES) {
    it(`${instType} instances`, () => {
      const instances = relations.entities
        .filter((e) => e.et === "instance" && e.st === instType && e.m)
        .map((e) => {
          const meta = JSON.parse(e.m!);
          const params = Object.fromEntries(
            Object.entries(meta.params ?? {}).map(([k, v]) => [k, (v as string[])[0]])
          );
          return {
            name: e.name,
            slug: e.slug,
            agent: meta.agent_doc_id ? (docs[meta.agent_doc_id]?.doc_no ?? null) : null,
            status: meta.status ?? null,
            params,
          };
        })
        .sort((a, b) => (a.agent ?? "").localeCompare(b.agent ?? "") || a.name.localeCompare(b.name));
      expect(instances).toMatchSnapshot();
    });
  }
});

// ---------------------------------------------------------------------------
// Invocations — atlas-distinct from Instances (A.2.2.1.4). One snapshot per
// type plus an aggregate count, mirroring the Instances structure.
// ---------------------------------------------------------------------------

describe("invocations", () => {
  it("invocation counts by type", () => {
    const counts: Record<string, number> = {};
    for (const e of relations.entities.filter((e) => e.et === "invocation")) {
      counts[e.st ?? "unknown"] = (counts[e.st ?? "unknown"] ?? 0) + 1;
    }
    expect(Object.fromEntries(Object.entries(counts).sort())).toMatchSnapshot();
  });

  it("invocations", () => {
    const invocations = relations.entities
      .filter((e) => e.et === "invocation" && e.m)
      .map((e) => {
        const meta = JSON.parse(e.m!);
        const params = Object.fromEntries(
          Object.entries(meta.params ?? {}).map(([k, v]) => [k, (v as string[])[0]])
        );
        return {
          name: e.name,
          slug: e.slug,
          subtype: e.st,
          agent: meta.agent_doc_id ? (docs[meta.agent_doc_id]?.doc_no ?? null) : null,
          status: meta.status ?? null,
          params,
        };
      })
      .sort(
        (a, b) =>
          (a.subtype ?? "").localeCompare(b.subtype ?? "") ||
          (a.agent ?? "").localeCompare(b.agent ?? "") ||
          a.name.localeCompare(b.name),
      );
    expect(invocations).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Allocation-system sub-doc content
//
// ICD params (above) capture structured `**Label**: value` fields extracted by
// build-graph. But Atlas docs also carry configuration in child docs with plain
// content — e.g. vault "Market Exposure" sections listing pool IDs and caps.
//
// parentId traversal is unreliable at depth 6 (the cap flattens the hierarchy).
// Instead: find all docs whose doc_no starts with the instance doc's own doc_no.
// The prefix is derived dynamically from the node, so it stays correct if the
// instance is renumbered — this is safe dynamic prefix use, not a hardcoded one.
// ---------------------------------------------------------------------------

describe("allocation-system sub-doc content", () => {
  const allDocs = Object.values(docs);

  function subdocsByPrefix(instanceDocNo: string): { title: string; content: string }[] {
    const prefix = instanceDocNo + ".";
    return allDocs
      .filter((n) => n.doc_no.startsWith(prefix))
      .sort((a, b) => a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true }))
      .map((n) => ({ title: n.title, content: n.content.trim() }));
  }

  // Map agent doc_no → agent name for readable, stable test names
  const agentNameByDocNo = new Map<string, string>();
  for (const e of relations.entities) {
    if (e.et === "agent" && e.st === "prime" && e.did) {
      const d = docs[e.did];
      if (d) agentNameByDocNo.set(d.doc_no, e.name);
    }
  }

  // One snapshot per instance nested under per-agent describes.
  // Each test covers only ~5–15 sub-docs so vitest can display the full diff.
  const agentDocNos = [
    ...new Set(
      relations.entities
        .filter((e) => e.et === "instance" && e.st === "allocation-system" && e.m)
        .map((e) => {
          const id = JSON.parse(e.m ?? "{}").agent_doc_id ?? "";
          return id ? (docs[id]?.doc_no ?? "") : "";
        })
        .filter(Boolean),
    ),
  ].sort();

  for (const agentDocNo of agentDocNos) {
    const agentName = agentNameByDocNo.get(agentDocNo) ?? agentDocNo;
    const agentInstances = relations.entities
      .filter(
        (e) =>
          e.et === "instance" &&
          e.st === "allocation-system" &&
          e.did &&
          e.m &&
          docs[JSON.parse(e.m).agent_doc_id]?.doc_no === agentDocNo,
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    describe(agentName, () => {
      for (const e of agentInstances) {
        it(e.name, () => {
          const instanceDoc = docs[e.did!];
          expect(instanceDoc ? subdocsByPrefix(instanceDoc.doc_no) : []).toMatchSnapshot();
        });
      }
    });
  }
});
