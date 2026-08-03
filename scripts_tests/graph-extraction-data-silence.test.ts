// Focused tests for chatbot-readiness extraction/data-silence fixes.
// These are pure module tests: no built artifacts or full graph build needed.

import { describe, it, expect } from "vitest";
// @ts-expect-error untyped .mjs build-script module
import { extractTransfers } from "../scripts/lib/graph-transfers.mjs";
// @ts-expect-error untyped .mjs build-script module
import { deriveInstanceName } from "../scripts/lib/graph-instances.mjs";

function entity(slug: string, name: string, entity_type = "ecosystem_actor", subtype: string | null = null): any {
  return {
    id: slug,
    slug,
    name,
    entity_type,
    subtype,
    defining_doc_id: null,
    is_active: 1,
    meta: null,
  };
}

describe("transfer extraction data silence", () => {
  it("models recurring grant authorizations separately from transfer events", () => {
    const docs = [
      {
        id: "auth-doc",
        doc_no: "A.2.8.2.1.2.1",
        title: "Grove Foundation Grant Authorization: December 2025",
        type: "Core",
        content:
          "The Atlas authorizes a grant of 800,000 USDS per month to the Grove Foundation from Grove's Prime Treasury for a three (3) month period beginning on December 1, 2025.",
      },
    ];
    const entityMap = new Map([
      ["sky-core", entity("sky-core", "Sky Core", "operational_party")],
      ["grove", entity("grove", "Grove", "agent", "prime")],
      ["grove-foundation", entity("grove-foundation", "Grove Foundation", "foundation")],
    ]);
    const edges: any[] = [];
    const addEntity = (slug: string, name: string, entity_type: string, subtype: string | null, defining_doc_id: string | null, meta: unknown) => {
      const ent = { ...entity(slug, name, entity_type, subtype), defining_doc_id, meta: meta ? JSON.stringify(meta) : null };
      entityMap.set(slug, ent);
      return ent;
    };

    const stats = extractTransfers(docs, new Map(docs.map((d) => [d.id, d])), new Map(docs.map((d) => [d.doc_no, d])), entityMap, edges, addEntity);

    expect(stats.authorizations).toBe(1);
    expect(edges.filter((e) => e.edgeType === "funds_transfer")).toEqual([]);
    expect(edges).toHaveLength(1);
    expect(edges[0].edgeType).toBe("funds_authorization");
    expect(edges[0].fromId).toBe("grove");
    expect(edges[0].toId).toBe("grove-foundation");
    expect(JSON.parse(edges[0].meta)).toMatchObject({
      kind: "grant_authorization",
      status: "authorized",
      populated: false,
      recorded_transfer: false,
      amounts: { "USDS per month": "800,000" },
      period_months: 3,
    });
    expect(JSON.parse(edges[0].meta).expected_record_fields).toContain("transaction hash");
  });

  it("models one-time grant authorizations that drop the per-month/Treasury recurrence phrasing", () => {
    const docs = [
      {
        id: "auth-doc-2",
        doc_no: "A.2.8.2.7.2.2.3.1",
        title: "Skybase Foundation Grant Authorization: July 2026",
        type: "Core",
        content:
          "The founding team of Skybase has proposed a one-time cash grant of 700,000 USDS to the Skybase Foundation from Skybase's SubProxy to provide operational capital.",
      },
    ];
    const entityMap = new Map([
      ["sky-core", entity("sky-core", "Sky Core", "operational_party")],
      ["skybase", entity("skybase", "Skybase", "agent", "prime")],
      ["skybase-foundation", entity("skybase-foundation", "Skybase Foundation", "foundation")],
    ]);
    const edges: any[] = [];
    const addEntity = (slug: string, name: string, entity_type: string, subtype: string | null, defining_doc_id: string | null, meta: unknown) => {
      const ent = { ...entity(slug, name, entity_type, subtype), defining_doc_id, meta: meta ? JSON.stringify(meta) : null };
      entityMap.set(slug, ent);
      return ent;
    };

    const stats = extractTransfers(docs, new Map(docs.map((d) => [d.id, d])), new Map(docs.map((d) => [d.doc_no, d])), entityMap, edges, addEntity);

    expect(stats.authorizations).toBe(1);
    expect(stats.warnings).toBe(0);
    expect(edges).toHaveLength(1);
    expect(edges[0].edgeType).toBe("funds_authorization");
    expect(edges[0].fromId).toBe("skybase");
    expect(edges[0].toId).toBe("skybase-foundation");
    expect(JSON.parse(edges[0].meta)).toMatchObject({
      kind: "grant_authorization",
      status: "authorized",
      amounts: { USDS: "700,000" },
    });
    expect(JSON.parse(edges[0].meta).period_months).toBeUndefined();
  });

  it("models planned token distributions with future details as data gaps", () => {
    const docs = [
      {
        id: "gap-doc",
        doc_no: "A.6.1.1.1.2.1.4.2.1.2.4",
        title: "Transfer Of Tokens For Token Launch",
        type: "Core",
        content:
          "The SPK Company Ltd account will transfer SPK tokens in connection with the token launch.\n\nThe amount and nature of these distributions will be specified in a future iteration of the Spark Artifact.",
      },
    ];
    const entityMap = new Map([
      ["sky-core", entity("sky-core", "Sky Core", "operational_party")],
      ["spk-company-ltd", entity("spk-company-ltd", "SPK Company Ltd", "ecosystem_actor")],
    ]);
    const edges: any[] = [];
    const addEntity = (slug: string, name: string, entity_type: string, subtype: string | null, defining_doc_id: string | null, meta: unknown) => {
      const ent = { ...entity(slug, name, entity_type, subtype), defining_doc_id, meta: meta ? JSON.stringify(meta) : null };
      entityMap.set(slug, ent);
      return ent;
    };

    const stats = extractTransfers(docs, new Map(docs.map((d) => [d.id, d])), new Map(docs.map((d) => [d.doc_no, d])), entityMap, edges, addEntity);

    expect(stats.dataGaps).toBe(1);
    expect(stats.warnings).toBe(0);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      fromId: "gap-doc",
      fromType: "doc",
      toId: "spk-company-ltd",
      toType: "entity",
      edgeType: "funds_data_gap",
    });
    expect(JSON.parse(edges[0].meta)).toMatchObject({
      kind: "planned_genesis_distribution_gap",
      status: "planned",
      token: "SPK",
      populated: false,
      recorded_transfer: false,
    });
    expect(JSON.parse(edges[0].meta).expected_record_fields).toContain("recipient");
  });
});

describe("instance entity naming", () => {
  it("adds agent and partner context to generic Integration Boost ICD names", () => {
    const icd = {
      title: "Integration Boost Primitive Instance Configuration Document",
    };
    const primRoot = {
      title: "Integration Boost Primitive",
      content: "The Integration Boost Primitive for Integration Boost instances. See [Integration Boost](uuid).",
    };
    const agentDoc = { title: "Spark" };
    const params = {
      "Integration Partner Name": ["Aave", "param-doc", "A.6.1.1.1.2.1.2.1.1"],
    };

    expect(deriveInstanceName(icd, primRoot, agentDoc, params)).toBe("Spark — Integration Boost — Aave");
  });

  it("keeps specific ICD names as written", () => {
    const icd = { title: "Spark MetaMorpho Vault Instance Configuration Document" };
    const primRoot = { title: "Allocation System Primitive", content: "" };
    const agentDoc = { title: "Spark" };

    expect(deriveInstanceName(icd, primRoot, agentDoc, {})).toBe("Spark MetaMorpho Vault");
  });
});
