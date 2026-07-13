// Pure unit test for the multisigs report builder. Runs under `bun test` (NOT
// vitest — src/server is excluded there). Fully in-memory, so a hand-built
// Indexes fixture is enough.
import { test, expect } from "bun:test";
import { buildMultisigsReport } from "./multisigs.ts";
import type { Indexes, AtlasNode, Edge, Entity } from "../indexes.ts";

// ── Fixture ──────────────────────────────────────────────────────────────
// Two multisigs (M1 "Alpha", M2 "Bravo"). M1 has two signer orgs (Soter 2,
// Zephyr 1) and one modifier (Gov). M2 has one signer org with no stated count.
function node(id: string, doc_no: string, title: string): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 3, parentId: null, order: 0, content: "", contentHash: `h-${id}`, addressRefs: [] } as AtlasNode;
}
function entity(id: string, slug: string, name: string, entity_type: string, defining_doc_id: string | null, meta: object | null): Entity {
  return { id, slug, name, entity_type, subtype: null, defining_doc_id, is_active: 1, meta: meta ? JSON.stringify(meta) : null };
}
function edge(id: number, from_id: string, to_id: string, edge_type: string, source_doc_nos: string[] | null, meta: object | null): Edge {
  return {
    id, from_id, from_type: "entity", to_id, to_type: "entity", edge_type,
    source_doc_nos: source_doc_nos ? JSON.stringify(source_doc_nos) : null,
    weight: 1, meta: meta ? JSON.stringify(meta) : null,
  };
}

function makeIx(): Indexes {
  const docs = [
    node("MD1", "A.1.1", "Alpha Multisig"),
    node("MD2", "A.2.1", "Bravo Multisig"),
    node("PD1", "A.1.1.4", "Alpha Usage Standards"),
  ];
  const entities: Entity[] = [
    entity("M1", "alpha-multisig", "Alpha Multisig", "multisig", "MD1", {
      address: "0xaaa", chain: "ethereum", threshold: "2/3", threshold_doc_no: "A.1.1.2", purpose_doc_no: "A.1.1.4",
    }),
    entity("M2", "bravo-multisig", "Bravo Multisig", "multisig", "MD2", {
      address: "0xbbb", chain: "solana", threshold: "1/2", threshold_doc_no: "A.2.1.2", purpose_doc_no: null,
    }),
    entity("O1", "soter-labs", "Soter Labs", "facilitator_org", null, null),
    entity("O2", "zephyr", "Zephyr", "facilitator_org", null, null),
    entity("O3", "gov", "Governance", "govops_org", null, null),
    entity("O4", "aloner", "Aloner Org", "operational_party", null, null),
  ];
  const edges: Edge[] = [
    edge(1, "O1", "M1", "signer_of", ["A.1.1.3"], { signer_count: 2, via_role: "core_facilitator" }),
    edge(2, "O2", "M1", "signer_of", ["A.1.1.3"], { signer_count: 1 }),
    edge(3, "O3", "M1", "can_modify_signers_of", ["A.1.1.5"], null),
    edge(4, "O4", "M2", "signer_of", ["A.2.1.3"], null), // no signer_count stated
  ];
  const docMap = new Map(docs.map((d) => [d.id, d]));
  return {
    docMap,
    byDocNo: new Map(docs.map((d) => [d.doc_no, d])),
    entities,
    edges,
    entityById: new Map(entities.map((e) => [e.id, e])),
    entityBySlug: new Map(entities.map((e) => [e.slug, e])),
  } as unknown as Indexes;
}

test("buildMultisigsReport rolls up signers, modifiers, threshold, and purpose", () => {
  const r = buildMultisigsReport(makeIx(), { include_provenance: true }) as any;
  expect(r.report).toBe("multisigs");
  expect(r.total).toBe(2);
  expect(r.truncated).toBe(false);

  // Sorted by name: Alpha before Bravo.
  const [alpha, bravo] = r.multisigs;
  expect(alpha.name).toBe("Alpha Multisig");
  expect(alpha.chain).toBe("ethereum");
  expect(alpha.address).toBe("0xaaa");
  expect(alpha.threshold).toBe("2/3");

  // Signer orgs resolved + name-sorted; per-org counts summed.
  expect(alpha.signer_orgs.map((s: any) => s.name)).toEqual(["Soter Labs", "Zephyr"]);
  expect(alpha.signer_org_count).toBe(2);
  expect(alpha.total_signers).toBe(3);
  expect(alpha.signer_orgs[0].via_role).toBe("core_facilitator");

  // Modifier + purpose resolved.
  expect(alpha.can_modify_signers).toEqual([{ name: "Governance", entity_type: "govops_org" }]);
  expect(alpha.purpose).toEqual({ doc_no: "A.1.1.4", title: "Alpha Usage Standards" });

  // Provenance aggregated from edge source_doc_nos + defining doc.
  expect(alpha.provenance.defining_doc_no).toBe("A.1.1");
  expect(alpha.provenance.threshold_doc_no).toBe("A.1.1.2");
  expect(alpha.provenance.signer_docs).toEqual(["A.1.1.3"]);
  expect(alpha.provenance.modification_docs).toEqual(["A.1.1.5"]);

  // Bravo: no stated signer counts → total_signers null, no purpose doc.
  expect(bravo.total_signers).toBeNull();
  expect(bravo.signer_org_count).toBe(1);
  expect(bravo.purpose).toBeNull();
});

test("include_provenance:false omits the provenance block", () => {
  const r = buildMultisigsReport(makeIx(), { include_provenance: false }) as any;
  expect(r.multisigs[0].provenance).toBeUndefined();
  // Non-provenance fields still present.
  expect(r.multisigs[0].threshold).toBe("2/3");
});
