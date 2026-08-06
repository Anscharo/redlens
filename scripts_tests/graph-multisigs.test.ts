// Unit tests for multisig extraction (Pattern 17, scripts/lib/graph-multisigs.mjs).
// Doc_no shapes mirror real multisig roots cited in the parse-atlas skill
// (e.g. A.3.7.1.3.5 Operator Multisig) — the five-child structural convention
// (Address / Number Of Signers / Signers / Usage Standards / Modifications).

import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractMultisigs, parseSignerGroups } from "../scripts/lib/graph-multisigs.mjs";
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

describe("parseSignerGroups", () => {
  it("parses the '(N) address(es) controlled by X' run shape", () => {
    const groups = parseSignerGroups(
      "The signers are three (3) addresses controlled by Core GovOps, and two (2) addresses controlled by Soter Labs.",
    );
    expect(groups).toEqual([
      { name: "Core GovOps", count: 3 },
      { name: "Soter Labs", count: 2 },
    ]);
  });

  it("parses the bullet '- {Party}: N signers' shape", () => {
    const groups = parseSignerGroups("- Soter Labs: 2 signers\n- Atlas Axis: 1 signer");
    expect(groups).toEqual([
      { name: "Soter Labs", count: 2 },
      { name: "Atlas Axis", count: 1 },
    ]);
  });

  it("parses the plain-bullet roster shape only after the intro sentence", () => {
    const groups = parseSignerGroups("The multisig has the following signers:\n\n- VoteWizard\n- LDR");
    expect(groups).toEqual([
      { name: "VoteWizard", count: 1 },
      { name: "LDR", count: 1 },
    ]);
  });

  it("returns an empty array for unparseable content", () => {
    expect(parseSignerGroups("Nothing structured here.")).toEqual([]);
  });

  it("does not read a plain bullet roster without the intro sentence", () => {
    expect(parseSignerGroups("- VoteWizard\n- LDR")).toEqual([]);
  });
});

function fiveChildDocs(rootDocNo: string, subject: string, opts: Partial<Record<string, string>> = {}) {
  return {
    threshold: mkDoc(`${rootDocNo}-thr`, `${rootDocNo}.1`, "Required Number Of Signers", opts.threshold ?? `The ${subject} has a 3/5 signing requirement.`),
    signers: mkDoc(`${rootDocNo}-sig`, `${rootDocNo}.2`, "Signers", opts.signers ?? ""),
    address: mkDoc(`${rootDocNo}-addr`, `${rootDocNo}.3`, "Address", opts.address ?? ""),
    usage: mkDoc(`${rootDocNo}-usage`, `${rootDocNo}.4`, "Usage Standards", opts.usage ?? `The ${subject} is used for emergency actions.`),
    modification: mkDoc(`${rootDocNo}-mod`, `${rootDocNo}.5`, "Modifications", opts.modification ?? ""),
  };
}

describe("extractMultisigs — happy path", () => {
  const rootDocNo = "A.3.7.1.3.5";
  const subject = "Test Operator Multisig";
  const root = mkDoc("root1", rootDocNo, subject);
  const kids = fiveChildDocs(rootDocNo, subject, {
    signers:
      "The signers of the Test Operator Multisig are three (3) addresses controlled by Core GovOps, and two (2) addresses controlled by Operational GovOps Soter Labs, and one (1) addresses controlled by Beta Actors.",
    address: "The address of the Test Operator Multisig on the Ethereum Mainnet is `0x1234567890123456789012345678901234567890`.",
    modification: "Core GovOps can change the signers of the Test Operator Multisig.",
  });
  const allDocs = [root, kids.threshold, kids.signers, kids.address, kids.usage, kids.modification];
  const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));
  const docById = new Map(allDocs.map((d) => [d.id, d]));

  const entityMap = new Map<string, any>();
  const soterLabs = makeEntity("soter-labs", "Soter Labs", "ecosystem_actor", {});
  entityMap.set(soterLabs.slug, soterLabs);
  const govopsOrg = makeEntity("test-govops-org", "Test GovOps Org", "govops_org", {});
  entityMap.set(govopsOrg.slug, govopsOrg);

  const edges: any[] = [
    { fromId: govopsOrg.id, fromType: "entity", toId: "agent-x", toType: "entity", edgeType: "core_govops_for", sourceDocNos: [] },
  ];

  const warns: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((m) => void warns.push(String(m)));

  const stats = extractMultisigs(allDocs, docById, docByDocNo, entityMap, edges).run(makeAddEntity(entityMap));

  it("creates one multisig entity with address/chain/threshold meta", () => {
    const ent = entityMap.get(subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    expect(ent).toBeTruthy();
    expect(ent.entity_type).toBe("multisig");
    expect(ent.id).toBe(root.id);
    const meta = JSON.parse(ent.meta);
    expect(meta.threshold).toBe("3/5");
    expect(meta.chain).toBe("ethereum");
    expect(meta.address).toBe("0x1234567890123456789012345678901234567890");
    expect(meta.purpose_doc_no).toBe(kids.usage.doc_no);
  });

  it("emits defines_entity and has_address edges", () => {
    expect(edges.some((e) => e.edgeType === "defines_entity" && e.fromId === root.id)).toBe(true);
    expect(edges.some((e) => e.edgeType === "has_address" && e.toId.startsWith("0x1234"))).toBe(true);
  });

  it("resolves a bare role reference to its current holder with meta.via_role", () => {
    const e = edges.find(
      (e) => e.edgeType === "signer_of" && e.fromId === govopsOrg.id,
    );
    expect(e).toBeTruthy();
    expect(JSON.parse(e.meta)).toMatchObject({ signer_count: 3, via_role: "core_govops" });
  });

  it("resolves a role-prefixed name to the existing named entity, dropping the role prefix", () => {
    const e = edges.find((e) => e.edgeType === "signer_of" && e.fromId === soterLabs.id);
    expect(e).toBeTruthy();
    expect(JSON.parse(e.meta)).toMatchObject({ signer_count: 2 });
  });

  it("creates an ecosystem_actor for an unresolvable signer name", () => {
    const beta = entityMap.get("beta-actors");
    expect(beta).toBeTruthy();
    expect(beta.entity_type).toBe("ecosystem_actor");
    expect(edges.some((e) => e.edgeType === "signer_of" && e.fromId === beta.id)).toBe(true);
  });

  it("emits can_modify_signers_of via the resolved role holder", () => {
    const e = edges.find((e) => e.edgeType === "can_modify_signers_of");
    expect(e).toBeTruthy();
    expect(e.fromId).toBe(govopsOrg.id);
    expect(JSON.parse(e.meta)).toMatchObject({ via_role: "core_govops" });
  });

  it("reports stats with no warnings", () => {
    expect(stats.roots).toBe(1);
    expect(stats.signerEdges).toBe(3);
    expect(stats.modifierEdges).toBe(1);
    expect(stats.created).toBeGreaterThanOrEqual(1);
    expect(stats.warnings).toBe(0);
    expect(warns).toEqual([]);
  });
});

describe("extractMultisigs — warning branches", () => {
  it("warns and falls back to root title when the threshold sentence doesn't parse", () => {
    const rootDocNo = "A.3.7.1.3.6";
    const root = mkDoc("root2", rootDocNo, "Unparseable Threshold Multisig");
    const kids = fiveChildDocs(rootDocNo, "irrelevant", {
      threshold: "This sentence has no threshold shape at all.",
      signers: "The signers are two (2) addresses controlled by Core GovOps.",
    });
    const allDocs = [root, kids.threshold, kids.signers, kids.address, kids.usage, kids.modification];
    const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));
    const docById = new Map(allDocs.map((d) => [d.id, d]));
    const entityMap = new Map<string, any>();
    const edges: any[] = [];
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m) => void warns.push(String(m)));

    const stats = extractMultisigs(allDocs, docById, docByDocNo, entityMap, edges).run(makeAddEntity(entityMap));

    expect(stats.roots).toBe(1);
    expect(warns.some((w) => w.includes("threshold did not parse"))).toBe(true);
    const ent = [...entityMap.values()][0];
    expect(ent.name).toBe(root.title);
    expect(JSON.parse(ent.meta).threshold).toBeNull();
    vi.restoreAllMocks();
  });

  it("warns and emits zero signer edges when the signers content doesn't parse", () => {
    const rootDocNo = "A.3.7.1.3.7";
    const root = mkDoc("root3", rootDocNo, "Unparseable Signers Multisig");
    const kids = fiveChildDocs(rootDocNo, "Unparseable Signers Multisig", {
      signers: "No structured roster here at all.",
    });
    const allDocs = [root, kids.threshold, kids.signers, kids.address, kids.usage, kids.modification];
    const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));
    const docById = new Map(allDocs.map((d) => [d.id, d]));
    const entityMap = new Map<string, any>();
    const edges: any[] = [];
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m) => void warns.push(String(m)));

    const stats = extractMultisigs(allDocs, docById, docByDocNo, entityMap, edges).run(makeAddEntity(entityMap));

    expect(stats.signerEdges).toBe(0);
    expect(warns.some((w) => w.includes("signers did not parse"))).toBe(true);
    vi.restoreAllMocks();
  });

  it("warns and leaves address null when the address content doesn't parse", () => {
    const rootDocNo = "A.3.7.1.3.8";
    const root = mkDoc("root4", rootDocNo, "Unparseable Address Multisig");
    const kids = fiveChildDocs(rootDocNo, "Unparseable Address Multisig", {
      signers: "The signers are one (1) addresses controlled by Core GovOps.",
      address: "No address sentence here.",
    });
    const allDocs = [root, kids.threshold, kids.signers, kids.address, kids.usage, kids.modification];
    const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));
    const docById = new Map(allDocs.map((d) => [d.id, d]));
    const entityMap = new Map<string, any>();
    const edges: any[] = [];
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m) => void warns.push(String(m)));

    extractMultisigs(allDocs, docById, docByDocNo, entityMap, edges).run(makeAddEntity(entityMap));

    expect(warns.some((w) => w.includes("address did not parse"))).toBe(true);
    expect(edges.some((e) => e.edgeType === "has_address")).toBe(false);
    const ent = [...entityMap.values()][0];
    expect(JSON.parse(ent.meta).address).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("extractMultisigs — agent prefix and collisions", () => {
  it("prefixes the display name with the owning agent under A.6.1.1.X", () => {
    const agentDocNo = "A.6.1.1.4";
    const agentDoc = mkDoc("agent4", agentDocNo, "Test Prime Four");
    const rootDocNo = `${agentDocNo}.5.1`;
    const root = mkDoc("root5", rootDocNo, "Freezer Multisig");
    const kids = fiveChildDocs(rootDocNo, "Freezer Multisig", {
      signers: "The signers are two (2) addresses controlled by Core GovOps.",
    });
    const allDocs = [agentDoc, root, kids.threshold, kids.signers, kids.address, kids.usage, kids.modification];
    const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));
    const docById = new Map(allDocs.map((d) => [d.id, d]));
    const entityMap = new Map<string, any>();
    const edges: any[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});

    extractMultisigs(allDocs, docById, docByDocNo, entityMap, edges).run(makeAddEntity(entityMap));

    const ent = [...entityMap.values()].find((e) => e.entity_type === "multisig");
    expect(ent.name).toBe("Test Prime Four Freezer Multisig");
    vi.restoreAllMocks();
  });

  it("skips a root when its display name collides with an existing entity and can't be disambiguated", () => {
    const rootDocNo = "A.3.7.1.3.9";
    const subject = "Duplicate Multisig";
    const root = mkDoc("root6", rootDocNo, subject);
    const kids = fiveChildDocs(rootDocNo, subject, {
      signers: "The signers are one (1) addresses controlled by Core GovOps.",
    });
    const allDocs = [root, kids.threshold, kids.signers, kids.address, kids.usage, kids.modification];
    const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));
    const docById = new Map(allDocs.map((d) => [d.id, d]));
    const entityMap = new Map<string, any>();
    const preexisting = makeEntity("duplicate-multisig", subject, "multisig", { meta: { chain: "ethereum" } });
    entityMap.set(preexisting.slug, preexisting);
    const edges: any[] = [];
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m) => void warns.push(String(m)));

    const stats = extractMultisigs(allDocs, docById, docByDocNo, entityMap, edges).run(makeAddEntity(entityMap));

    expect(stats.roots).toBe(1);
    expect(warns.some((w) => w.includes("slug collision, skipped"))).toBe(true);
    expect(edges.some((e) => e.edgeType === "defines_entity")).toBe(false);
    vi.restoreAllMocks();
  });

  it("disambiguates by chain suffix when the colliding entity is on a different chain", () => {
    const rootDocNo = "A.3.7.1.3.10";
    const subject = "Chain Split Multisig";
    const root = mkDoc("root7", rootDocNo, subject);
    const kids = fiveChildDocs(rootDocNo, subject, {
      signers: "The signers are one (1) addresses controlled by Core GovOps.",
      address: `The address of the ${subject} on the Ethereum Mainnet is \`0x9999999999999999999999999999999999999999\`.`,
    });
    const allDocs = [root, kids.threshold, kids.signers, kids.address, kids.usage, kids.modification];
    const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));
    const docById = new Map(allDocs.map((d) => [d.id, d]));
    const entityMap = new Map<string, any>();
    const preexisting = makeEntity("chain-split-multisig", subject, "multisig", { meta: { chain: "solana" } });
    entityMap.set(preexisting.slug, preexisting);
    const edges: any[] = [];
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m) => void warns.push(String(m)));

    const stats = extractMultisigs(allDocs, docById, docByDocNo, entityMap, edges).run(makeAddEntity(entityMap));

    expect(stats.roots).toBe(1);
    expect(warns.some((w) => w.includes("slug collision"))).toBe(false);
    const created = entityMap.get("chain-split-multisig-ethereum");
    expect(created).toBeTruthy();
    expect(created.name).toBe("Chain Split Multisig (Ethereum)");
    vi.restoreAllMocks();
  });
});
