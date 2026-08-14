// Unit tests for Pattern 16 Active Data table extraction (Phase 2.7,
// scripts/lib/graph-active-data.mjs). The module keys its five tables off
// hardcoded doc UUIDs, so the fixtures below reuse those exact UUIDs — that
// identity IS the contract (doc_nos move, uuids don't). Table shapes mirror
// the real atlas columns; values are synthetic so no assertion depends on
// current atlas content.

import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractActiveData } from "../scripts/lib/graph-active-data.mjs";

const CURRENT_DELEGATES = "5f584db8-f8d8-4118-988c-b2bc3f68ceb7";
const DERECOGNIZED = "e7aec672-ed19-4329-aaf7-736950be2eb7";
const SRC = "d9c6ed16-5b0d-4a6f-bb43-387398090afc";
const FORUM_ACCOUNTS = "b71564fd-22e0-4c69-99d1-5b23fc1fa329";
const BREACH_REGISTRY = "1ddd9cf6-3f93-4a33-8c1d-80405eec1ffb";
const KNOWN_UNEXTRACTED = "93f5b36b-06a7-4282-9fd7-14e0cbafd08e";

const EA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CONTRACT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const GOV = "0xcccccccccccccccccccccccccccccccccccccccc";

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function doc(id: string, doc_no: string, title: string, content: string, type = "Active Data"): any {
  return { id, doc_no, title, type, content };
}

function entity(slug: string, name: string, entity_type = "delegate_org", meta: any = null): any {
  return { id: slug, slug, name, entity_type, subtype: null, defining_doc_id: null, is_active: 1, meta };
}

function run(docs: any[], over: { entityMap?: Map<string, any>; edges?: any[] } = {}) {
  const entityMap = over.entityMap ?? new Map([["sky-governance", entity("sky-governance", "Sky Governance", "governance_body")]]);
  const edges = over.edges ?? [];
  const addressesAtlas: Record<string, any> = {};
  const addressesRaw: Record<string, any> = {};
  const docById = new Map(docs.map((d) => [d.id, d]));
  const result = extractActiveData(docs, docById, entityMap, edges, addressesAtlas, addressesRaw);
  return { result, edges, entityMap, addressesAtlas, addressesRaw };
}

// Every table is optional; a fixture that omits one must not make the module
// touch it. Table 4 and 5 warn when absent, so silence those in the fixtures
// that deliberately leave them out.
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
const log = vi.spyOn(console, "log").mockImplementation(() => {});
afterEach(() => {
  warn.mockClear();
  log.mockClear();
});

const DELEGATE_HEADERS = ["Delegate Name", "EA Address", "Delegation Contract", "Forum Post"];

describe("Table 1 — Current Aligned Delegates", () => {
  it("creates an entity, registers both addresses, and emits role-tagged has_address edges", () => {
    const d = doc(CURRENT_DELEGATES, "A.1.6.6.1.2.0.6.1", "Current Aligned Delegates",
      table(DELEGATE_HEADERS, [["Cloaky", EA, CONTRACT, "[post](https://forum.sky.money/t/cloaky/1)"]]));
    const { result, edges, entityMap, addressesAtlas, addressesRaw } = run([d]);

    expect(result).toMatchObject({ created: 1, enriched: 0 });
    const ent = entityMap.get("cloaky");
    expect(ent).toMatchObject({ name: "Cloaky", entity_type: "delegate_org", is_active: 1, defining_doc_id: CURRENT_DELEGATES });
    expect(JSON.parse(ent.meta)).toEqual({ source: "active_data_table", forum_url: "https://forum.sky.money/t/cloaky/1" });

    expect(addressesAtlas[EA]).toEqual({ chain: "ethereum", chains: ["ethereum"], roles: ["delegate"], entityLabel: "Cloaky" });
    expect(addressesAtlas[CONTRACT].entityLabel).toBe("Cloaky Delegation Contract");
    expect(addressesRaw[EA]).toMatchObject({ label: "Cloaky", aliases: [] });

    const roles = edges.filter((e) => e.edgeType === "has_address").map((e) => [e.toId, JSON.parse(e.meta).role]);
    expect(roles).toEqual([[`${EA}:ethereum`, "ea_address"], [`${CONTRACT}:ethereum`, "delegation_contract"]]);
    expect(edges.some((e) => e.edgeType === "listed_in" && e.toId === CURRENT_DELEGATES)).toBe(true);
    expect(edges.find((e) => e.edgeType === "aligned_delegate_for")).toMatchObject({
      fromId: ent.id, toId: "sky-governance", sourceDocNos: ["A.1.6.6.1.2.0.6.1"],
    });
  });

  it("enriches an existing chainlog-bootstrapped entity in place, upgrading ecosystem_actor → delegate_org", () => {
    const existing = entity("blue", "BLUE", "ecosystem_actor", JSON.stringify({ source: "chainlog" }));
    const edges = [
      { fromId: "blue", fromType: "entity", toId: `${EA}:ethereum`, toType: "address", edgeType: "has_address" },
      { fromId: "blue", fromType: "entity", toId: `${CONTRACT}:ethereum`, toType: "address", edgeType: "has_address" },
      { fromId: "blue", fromType: "entity", toId: "some-doc", toType: "doc", edgeType: "listed_in" },
    ];
    const d = doc(CURRENT_DELEGATES, "A.1.6.6.1.2.0.6.1", "Current Aligned Delegates",
      table(DELEGATE_HEADERS, [["BLUE", EA, CONTRACT, "[post](https://forum.sky.money/t/blue/2)"]]));
    const { result, edges: out, addressesAtlas } = run([d], {
      entityMap: new Map([
        ["sky-governance", entity("sky-governance", "Sky Governance", "governance_body")],
        ["blue", existing],
      ]),
      edges,
    });

    expect(result).toMatchObject({ enriched: 1, created: 0 });
    expect(existing.entity_type).toBe("delegate_org");
    expect(JSON.parse(existing.meta)).toEqual({ source: "chainlog", forum_url: "https://forum.sky.money/t/blue/2" });
    expect(JSON.parse(out[0].meta)).toEqual({ role: "ea_address" });
    expect(JSON.parse(out[1].meta)).toEqual({ role: "delegation_contract" });
    expect(out[2].meta).toBeUndefined(); // non-address edge left alone
    expect(addressesAtlas).toEqual({}); // an existing entity's addresses are already registered
  });

  it("skips rows with no name and rows with no EA address", () => {
    const d = doc(CURRENT_DELEGATES, "A.1.6.6.1.2.0.6.1", "Current Aligned Delegates",
      table(DELEGATE_HEADERS, [["", EA, "", ""], ["No Address", "", "", ""]]));
    const { result, edges } = run([d]);
    expect(result).toMatchObject({ created: 0, enriched: 0 });
    expect(edges).toEqual([]);
  });

  it("registers only the EA address when the delegation-contract cell is empty", () => {
    const d = doc(CURRENT_DELEGATES, "A.1.6.6.1.2.0.6.1", "Current Aligned Delegates",
      table(DELEGATE_HEADERS, [["Solo", EA, "N/A", ""]]));
    const { addressesAtlas, edges } = run([d]);
    expect(Object.keys(addressesAtlas)).toEqual([EA]);
    expect(edges.filter((e) => e.edgeType === "has_address")).toHaveLength(1);
  });
});

describe("Table 2 — Derecognized Alignment Conservers", () => {
  it("creates inactive delegate_org entities, carrying the date and reasoning URL", () => {
    const d = doc(DERECOGNIZED, "A.1.6.6.1.4.0.6.1", "Derecognized Alignment Conservers",
      table(["Identity", "Date", "Reasoning Post"], [
        ["Flip Flop Flap", "2025-03-01", "[why](https://forum.sky.money/t/ffd/9)"],
        ["-", "2025-03-02", ""],           // placeholder row
        ["Sky Governance", "2025-03-03", ""], // slug already taken → skipped
        ["", "", ""],                        // empty row
      ]));
    const { result, entityMap, edges } = run([d]);
    expect(result).toMatchObject({ derecognized: 1 });
    const ent = entityMap.get("flip-flop-flap");
    expect(ent).toMatchObject({ entity_type: "delegate_org", is_active: 0 });
    expect(JSON.parse(ent.meta)).toEqual({
      source: "active_data_table",
      derecognition_date: "2025-03-01",
      forum_url: "https://forum.sky.money/t/ffd/9",
    });
    expect(edges).toEqual([
      { fromId: ent.id, fromType: "entity", toId: DERECOGNIZED, toType: "doc", edgeType: "listed_in", meta: undefined },
    ]);
  });
});

describe("Table 3 — SRC Membership Registry", () => {
  it("creates src_member entities and registers a verified governance address", () => {
    const d = doc(SRC, "A.1.6.6.1.5.0.6.1", "SRC Membership Registry",
      table(["Name or Alias", "Domain Expertise", "Start Date", "Term Status", "Standing", "Verified Governance Address"], [
        ["Ryan", "Risk", "2025-01-01", "Active", "Good", GOV],
        ["NoAddr", "Legal", "2025-02-01", "Active", "Good", "N/A"],
        ["", "", "", "", "", ""],
      ]));
    const { result, entityMap, edges, addressesAtlas, addressesRaw } = run([d]);
    expect(result).toMatchObject({ srcMembers: 2 });
    expect(entityMap.get("ryan")).toMatchObject({ entity_type: "src_member", is_active: 1 });
    expect(JSON.parse(entityMap.get("ryan").meta)).toEqual({
      source: "active_data_table", domain_expertise: "Risk", start_date: "2025-01-01", term_status: "Active", standing: "Good",
    });
    expect(addressesAtlas[GOV]).toMatchObject({ roles: ["governance"], entityLabel: "Ryan" });
    expect(addressesRaw[GOV]).toMatchObject({ label: "Ryan" });
    expect(edges.filter((e) => e.edgeType === "has_address")).toHaveLength(1);
    expect(edges.filter((e) => e.edgeType === "listed_in")).toHaveLength(2);
  });

  it("skips a name whose slug is already an entity", () => {
    const d = doc(SRC, "A.1.6.6.1.5.0.6.1", "SRC Membership Registry",
      table(["Name or Alias", "Verified Governance Address"], [["Sky Governance", GOV]]));
    const { result, addressesAtlas } = run([d]);
    expect(result).toMatchObject({ srcMembers: 0 });
    expect(addressesAtlas).toEqual({});
  });
});

describe("Table 4 — Current Authorized Forum Accounts", () => {
  const FORUM_HEADERS = ["Entity Name", "Role", "Entity Handle", "Handles of Authorized Representatives"];

  it("resolves a short name to an existing entity, records the alias, and links reps", () => {
    const redline = entity("redline-facilitation-group", "Redline Facilitation Group", "facilitator_org");
    const d = doc(FORUM_ACCOUNTS, "A.2.7.1.1.1.1.4.0.6.1", "Current Authorized Forum Accounts",
      table(FORUM_HEADERS, [["Redline", "Facilitator", "@redline", "alice (lead), bob"]]));
    const { result, entityMap, edges } = run([d], {
      entityMap: new Map([
        ["sky-governance", entity("sky-governance", "Sky Governance", "governance_body")],
        ["redline-facilitation-group", redline],
      ]),
    });

    expect(result).toMatchObject({ forumRows: 1, forumReps: 2 });
    const meta = JSON.parse(redline.meta);
    expect(meta).toMatchObject({ aliases: ["Redline"], forum_handle: "@redline", forum_role: "Facilitator" });
    expect(entityMap.get("alice")).toMatchObject({ entity_type: "ecosystem_actor", subtype: "individual" });
    const repEdges = edges.filter((e) => e.edgeType === "authorized_rep_for");
    expect(repEdges.map((e) => e.fromId)).toEqual([entityMap.get("alice").id, entityMap.get("bob").id]);
    expect(JSON.parse(repEdges[0].meta)).toEqual({ handle: "alice" });
    expect(JSON.parse(edges.find((e) => e.edgeType === "listed_in")!.meta)).toEqual({ handle: "@redline", role: "Facilitator" });
  });

  it("mints an entity for an unknown name, treats N/A cells as absent, and drops a self-referential rep", () => {
    const d = doc(FORUM_ACCOUNTS, "A.2.7.1.1.1.1.4.0.6.1", "Current Authorized Forum Accounts",
      table(FORUM_HEADERS, [
        ["Amatsu", "N/A", "N/A", "Amatsu"], // rep resolves to the row entity itself
        ["N/A", "Facilitator", "@skip", "x"],
        ["Blank Reps", "Rep", "@blank", "N/A"],
      ]));
    const { result, entityMap, edges } = run([d]);
    expect(result).toMatchObject({ forumRows: 2, forumReps: 0 });
    expect(entityMap.get("amatsu")).toMatchObject({ entity_type: "ecosystem_actor", defining_doc_id: FORUM_ACCOUNTS });
    expect(JSON.parse(entityMap.get("amatsu").meta)).toEqual({ source: "forum_accounts_table" }); // N/A role/handle not stored
    expect(edges.filter((e) => e.edgeType === "authorized_rep_for")).toEqual([]);
    expect(entityMap.has("n-a")).toBe(false);
  });

  it("reuses an existing org for a rep handle instead of minting an individual, recording the short form as an alias", () => {
    // "Soter" resolves to "Soter Labs" through resolveAliasedEntity's
    // word-boundary prefix fallback — the rep half of the same short-name
    // merge Table 4 does for row entities.
    const soter = entity("soter-labs", "Soter Labs", "development_company");
    const d = doc(FORUM_ACCOUNTS, "A.2.7.1.1.1.1.4.0.6.1", "Current Authorized Forum Accounts",
      table(FORUM_HEADERS, [["Amatsu", "Rep", "@amatsu", "Soter"]]));
    const { edges, entityMap } = run([d], {
      entityMap: new Map([
        ["sky-governance", entity("sky-governance", "Sky Governance", "governance_body")],
        ["soter-labs", soter],
      ]),
    });
    expect(soter.subtype).toBeNull(); // not downgraded to an individual
    expect(entityMap.get("soter-labs")).toBe(soter);
    expect(JSON.parse(soter.meta).aliases).toEqual(["Soter"]);
    expect(edges.find((e) => e.edgeType === "authorized_rep_for")).toMatchObject({
      fromId: "soter-labs",
      toId: entityMap.get("amatsu").id,
    });
  });

  it("warns when the table doc is missing entirely", () => {
    run([]);
    expect(warn.mock.calls.flat().join(" ")).toContain(FORUM_ACCOUNTS);
  });
});

describe("Table 5 — Aligned Delegate Breach Registry", () => {
  it("attaches dated breach events to an existing delegate and mints one for an unknown identity", () => {
    const cloaky = entity("cloaky", "Cloaky");
    const d = doc(BREACH_REGISTRY, "A.1.6.6.1.3.0.6.1", "Aligned Delegate Breach Registry",
      table(["Date", "Identity", "Breach Tier", "Reasoning Post"], [
        ["2025-05-01", "Cloaky", "Tier 1", "[why](https://forum.sky.money/t/b/3)"],
        ["2025-06-01", "Newcomer", "Tier 2", ""],
        ["2025-07-01", "", "Tier 3", ""],
      ]));
    const { result, edges, entityMap } = run([d], {
      entityMap: new Map([
        ["sky-governance", entity("sky-governance", "Sky Governance", "governance_body")],
        ["cloaky", cloaky],
      ]),
    });
    expect(result).toMatchObject({ breaches: 2 });
    expect(entityMap.get("newcomer")).toMatchObject({ entity_type: "delegate_org", defining_doc_id: BREACH_REGISTRY });
    expect(JSON.parse(edges[0].meta)).toEqual({
      date: "2025-05-01", breach_tier: "Tier 1", reasoning_url: "https://forum.sky.money/t/b/3",
    });
    expect(JSON.parse(edges[1].meta)).toEqual({ date: "2025-06-01", breach_tier: "Tier 2" });
  });

  it("warns when the registry doc is missing entirely", () => {
    run([]);
    expect(warn.mock.calls.flat().join(" ")).toContain(BREACH_REGISTRY);
  });
});

describe("drift detector", () => {
  it("warns once per unhandled Active Data table that has rows, and totals them", () => {
    const docs = [
      doc("new-table", "A.9.9.0.6.1", "Payment Ledger", table(["Date", "Amount"], [["2025-01-01", "100"]])),
      doc("another", "A.9.8.0.6.1", "Registered Multisigs", table(["Name"], [["Foo"]])),
      doc("empty", "A.9.7.0.6.1", "Empty Ledger", table(["Date", "Amount"], [["", ""]])),
      doc(KNOWN_UNEXTRACTED, "A.1.10.2.5.1.3.2.0.6.1", "Spell Checklists", table(["Name"], [["Bar"]])),
      doc("not-active-data", "A.9.6", "Prose", table(["Name"], [["Baz"]]), "Core"),
    ];
    const { result } = run(docs);
    expect(result.driftWarnings).toBe(2);
    const warned = warn.mock.calls.flat().join("\n");
    expect(warned).toContain('[drift] unextracted Active Data table: A.9.9.0.6.1 "Payment Ledger"');
    expect(warned).toContain('[drift] unextracted Active Data table: A.9.8.0.6.1 "Registered Multisigs"');
    expect(warned).toContain("[drift] 2 Active Data table(s) contain rows but are not extracted");
    expect(warned).not.toContain("Empty Ledger");
    expect(warned).not.toContain("Spell Checklists");
  });

  it("stays silent when every Active Data table is handled or empty", () => {
    const docs = [
      doc(CURRENT_DELEGATES, "A.1.6.6.1.2.0.6.1", "Current Aligned Delegates", table(DELEGATE_HEADERS, [])),
      doc(FORUM_ACCOUNTS, "A.2.7.1.1.1.1.4.0.6.1", "Current Authorized Forum Accounts", ""),
      doc(BREACH_REGISTRY, "A.1.6.6.1.3.0.6.1", "Aligned Delegate Breach Registry", ""),
    ];
    const { result } = run(docs);
    expect(result).toEqual({
      enriched: 0, created: 0, derecognized: 0, srcMembers: 0,
      forumRows: 0, forumReps: 0, breaches: 0, driftWarnings: 0,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
