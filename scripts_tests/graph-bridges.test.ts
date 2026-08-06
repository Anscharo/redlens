// Unit tests for bridge validator set extraction (Pattern 21,
// scripts/lib/graph-bridges.mjs). Doc_no shapes mirror the real SkyLink /
// SLL Governance Bridge trees from the parse-atlas skill (A.1.10.4.1.*).

import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractBridges } from "../scripts/lib/graph-bridges.mjs";
// @ts-expect-error — .mjs without types; runtime-only import.
import { makeEntity } from "../scripts/lib/graph-patterns.mjs";

afterEach(() => vi.restoreAllMocks());

function mkDoc(id: string, doc_no: string, title: string, content = "") {
  return {
    id,
    doc_no,
    title,
    type: "Core",
    depth: Math.min(doc_no.split(".").length - 1, 6),
    parentId: null,
    order: 0,
    content,
    addressRefs: [],
  };
}

function makeAddEntity(entityMap: Map<string, any>) {
  return function addEntity(
    slug: string,
    name: string,
    entity_type: string,
    subtype: string | null,
    defining_doc_id: string | null,
    meta: unknown,
  ) {
    const existing = entityMap.get(slug);
    if (existing) return existing;
    const ent = makeEntity(slug, name, entity_type, { subtype, defining_doc_id, meta });
    entityMap.set(slug, ent);
    return ent;
  };
}

function run(allDocs: ReturnType<typeof mkDoc>[], entityMap = new Map<string, any>(), edges: any[] = []) {
  const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));
  const docById = new Map(allDocs.map((d) => [d.id, d]));
  const warns: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((m) => void warns.push(String(m)));
  const stats = extractBridges(allDocs, docById, docByDocNo, entityMap, edges, makeAddEntity(entityMap));
  return { stats, entityMap, edges, warns, docByDocNo, docById };
}

describe("extractBridges — SkyLink happy path (system-ancestor naming)", () => {
  const networkBridge = mkDoc("net1", "A.9.4.1", "Test Network SkyLink Bridge");
  const validatorsContainer = mkDoc("vc1", "A.9.4.1.2", "Validators", "The documents herein specify validator configuration.");
  const root = mkDoc("root1", "A.9.4.1.2.1", "Test Token Bridge");
  const roster = mkDoc("roster1", "A.9.4.1.2.1.1", "Validators", "The validators for the Test Token Bridge are Acme Corp, Beta LLC, and Gamma Inc.");
  const quorum = mkDoc("quorum1", "A.9.4.1.2.1.2", "Quorum Requirement", "The quorum requirement for the Test Token Bridge is 4/7.");
  const allDocs = [networkBridge, validatorsContainer, root, roster, quorum];

  const { stats, entityMap, edges, warns } = run(allDocs);

  it("creates one bridge entity qualified by the nearest ancestor Bridge title", () => {
    const bridge = [...entityMap.values()].find((e) => e.entity_type === "bridge");
    expect(bridge).toBeTruthy();
    expect(bridge.name).toBe("Test Token Bridge (Test Network SkyLink Bridge)");
    expect(bridge.id).toBe(root.id);
    const meta = JSON.parse(bridge.meta);
    expect(meta.quorum).toBe("4/7");
    expect(meta.quorum_doc_no).toBe(quorum.doc_no);
    expect(meta.component).toBe("Test Token Bridge");
  });

  it("emits defines_entity and one validator_of edge per roster name", () => {
    expect(edges.some((e) => e.edgeType === "defines_entity" && e.fromId === root.id)).toBe(true);
    const validatorEdges = edges.filter((e) => e.edgeType === "validator_of");
    expect(validatorEdges).toHaveLength(3);
    const entitiesById = new Map([...entityMap.values()].map((v) => [v.id, v]));
    const names = validatorEdges.map((e) => entitiesById.get(e.fromId)?.name).sort();
    expect(names).toEqual(["Acme Corp", "Beta LLC", "Gamma Inc"]);
  });

  it("creates ecosystem_actor/bridge_validator entities for each roster name", () => {
    const acme = entityMap.get("acme-corp");
    expect(acme).toBeTruthy();
    expect(acme.entity_type).toBe("ecosystem_actor");
    expect(acme.subtype).toBe("bridge_validator");
  });

  it("reports clean stats with no warnings", () => {
    expect(stats.roots).toBe(1);
    expect(stats.validatorEdges).toBe(3);
    expect(stats.created).toBe(3);
    expect(stats.warnings).toBe(0);
    expect(warns).toEqual([]);
  });
});

describe("extractBridges — SLL shape (network-qualified naming, no system ancestor)", () => {
  const root = mkDoc("root2", "A.9.5.2", "Avalanche");
  const roster = mkDoc("roster2", "A.9.5.2.1", "Validators", "The validators for the Governance Bridge are Delta Org and Epsilon Org.");
  const quorum = mkDoc("quorum2", "A.9.5.2.2", "Quorum Requirement", "The quorum requirement for the Governance Bridge is 5/8.");
  const allDocs = [root, roster, quorum];
  const { entityMap } = run(allDocs);

  it("qualifies the display name with the root title when it differs from the roster subject", () => {
    const bridge = [...entityMap.values()].find((e) => e.entity_type === "bridge");
    expect(bridge.name).toBe("Governance Bridge (Avalanche)");
  });
});

describe("extractBridges — agent-prefixed root", () => {
  const agentDoc = mkDoc("agent3", "A.6.1.1.3", "Test Executor");
  const root = mkDoc("root3", "A.6.1.1.3.4.1", "Test Executor Bridge");
  const roster = mkDoc("roster3", "A.6.1.1.3.4.1.1", "Validators", "The validators for the Test Executor Bridge are Zeta Org.");
  const quorum = mkDoc("quorum3", "A.6.1.1.3.4.1.2", "Quorum Requirement", "The quorum requirement for the Test Executor Bridge is 1/1.");
  const allDocs = [agentDoc, root, roster, quorum];
  const { entityMap } = run(allDocs);

  it("prefixes the display name with the owning agent's title", () => {
    const bridge = [...entityMap.values()].find((e) => e.entity_type === "bridge");
    expect(bridge.name).toBe("Test Executor Test Executor Bridge");
  });
});

describe("extractBridges — warning and skip branches", () => {
  it("warns on a half-parsed pair (roster parses, quorum doesn't) and creates no entity", () => {
    const root = mkDoc("root4", "A.9.6.1", "Half Parsed Bridge");
    const roster = mkDoc("roster4", "A.9.6.1.1", "Validators", "The validators for the Half Parsed Bridge are Org A.");
    const quorum = mkDoc("quorum4", "A.9.6.1.2", "Quorum Requirement", "No quorum sentence here.");
    const { stats, entityMap, warns } = run([root, roster, quorum]);

    expect(stats.roots).toBe(0);
    expect(warns.some((w) => w.includes("only half-parsed"))).toBe(true);
    expect([...entityMap.values()].some((e) => e.entity_type === "bridge")).toBe(false);
  });

  it("silently skips a pair of container docs where neither sentence parses", () => {
    const root = mkDoc("root5", "A.2.2.6.1", "Root Edit Spec");
    const roster = mkDoc("roster5", "A.2.2.6.1.1", "Validators", "The documents herein specify validator configuration.");
    const quorum = mkDoc("quorum5", "A.2.2.6.1.2", "Quorum Requirement", "Quorum requirements are specified per deployment.");
    const { stats, entityMap, warns } = run([root, roster, quorum]);

    expect(stats.roots).toBe(0);
    expect(warns).toEqual([]);
    expect(entityMap.size).toBe(0);
  });

  it("warns on a subject mismatch between roster and quorum sentences but still creates the entity", () => {
    const root = mkDoc("root6", "A.9.7.1", "Mismatch Bridge");
    const roster = mkDoc("roster6", "A.9.7.1.1", "Validators", "The validators for the Roster Subject Bridge are Org A.");
    const quorum = mkDoc("quorum6", "A.9.7.1.2", "Quorum Requirement", "The quorum requirement for the Quorum Subject Bridge is 2/3.");
    const { stats, entityMap, warns } = run([root, roster, quorum]);

    expect(stats.roots).toBe(1);
    expect(warns.some((w) => w.includes("subject mismatch"))).toBe(true);
    const bridge = [...entityMap.values()].find((e) => e.entity_type === "bridge");
    expect(bridge).toBeTruthy();
  });

  it("warns when the pair's parent doc_no has no root doc in the corpus", () => {
    const roster = mkDoc("roster7", "A.9.8.1.1", "Validators", "The validators for the Orphan Bridge are Org A.");
    const quorum = mkDoc("quorum7", "A.9.8.1.2", "Quorum Requirement", "The quorum requirement for the Orphan Bridge is 2/3.");
    const { stats, warns } = run([roster, quorum]);

    expect(stats.roots).toBe(0);
    expect(warns.some((w) => w.includes("no root doc for pair"))).toBe(true);
  });

  it("warns when the roster sentence yields no names, but still creates the entity with zero validator edges", () => {
    const root = mkDoc("root8", "A.9.9.1", "Empty Roster Bridge");
    const roster = mkDoc("roster8", "A.9.9.1.1", "Validators", "The validators for the Empty Roster Bridge are  .");
    const quorum = mkDoc("quorum8", "A.9.9.1.2", "Quorum Requirement", "The quorum requirement for the Empty Roster Bridge is 2/3.");
    const { stats, entityMap, warns } = run([root, roster, quorum]);

    expect(stats.roots).toBe(1);
    expect(stats.validatorEdges).toBe(0);
    expect(warns.some((w) => w.includes("roster yielded no names"))).toBe(true);
    expect([...entityMap.values()].some((e) => e.entity_type === "bridge")).toBe(true);
  });

  it("warns and skips when the display name collides with an existing entity", () => {
    const root = mkDoc("root9", "A.9.10.1", "Collide Subject Bridge");
    const roster = mkDoc("roster9", "A.9.10.1.1", "Validators", "The validators for the Collide Subject Bridge are Org A.");
    const quorum = mkDoc("quorum9", "A.9.10.1.2", "Quorum Requirement", "The quorum requirement for the Collide Subject Bridge is 2/3.");
    const entityMap = new Map<string, any>();
    const preexisting = makeEntity("collide-subject-bridge", "Collide Subject Bridge", "bridge", {});
    entityMap.set(preexisting.slug, preexisting);
    const { stats, warns, edges } = run([root, roster, quorum], entityMap);

    expect(stats.roots).toBe(1);
    expect(warns.some((w) => w.includes("slug collision, skipped"))).toBe(true);
    expect(edges.some((e) => e.edgeType === "defines_entity")).toBe(false);
  });
});
