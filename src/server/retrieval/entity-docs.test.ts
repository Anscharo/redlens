import { test, expect } from "bun:test";
import type { Indexes } from "./indexes.ts";
import { artifactDocIds, entityScopeDocIds, outsideScope } from "./entity-docs.ts";

const doc = (id: string, type = "Core") => [id, { id, doc_no: `A.${id}`, title: `Doc ${id}`, type }] as const;
const prime = { id: "root", defining_doc_id: "root" };
const ix = {
  docMap: new Map([doc("root", "Article"), doc("child"), doc("grandchild", "Active Data"), doc("linked"), doc("elsewhere")]),
  childrenIndex: new Map([["root", [{ id: "child" }]], ["child", [{ id: "grandchild" }]]]),
  entityById: new Map([["root", prime]]),
  edges: [
    { from_id: "root", to_id: "linked", to_type: "doc", edge_type: "responsible_party_for" },
    { from_id: "root", to_id: "0xabc", to_type: "address", edge_type: "has_address" },
    { from_id: "other", to_id: "elsewhere", to_type: "doc", edge_type: "duty_for" },
  ],
} as unknown as Indexes;

test("an entity's documents are its edge-linked docs and its whole artifact subtree", () => {
  expect(entityScopeDocIds(ix, prime).sort()).toEqual(["child", "grandchild", "linked", "root"]);
});

test("an entity with no defining doc keeps only its edge-linked documents", () => {
  expect(entityScopeDocIds(ix, { id: "other", defining_doc_id: null })).toEqual(["elsewhere"]);
});

test("the artifact alone can be narrowed to one document type", () => {
  expect(artifactDocIds(ix, "root", "Active Data")).toEqual(["grandchild"]);
  expect(artifactDocIds(ix, "missing")).toEqual([]);
});

test("an empty scoped search hands back the matches outside the scope", () => {
  const out = outsideScope(ix, "Osero", [{ id: "elsewhere" }], 0);
  expect(out.outside_entity_scope?.matches).toEqual([{ id: "elsewhere", doc_no: "A.elsewhere", title: "Doc elsewhere" }]);
  expect(out.outside_entity_scope?.note).toContain("The atlas is not silent");
  expect(outsideScope(ix, "Osero", [{ id: "elsewhere" }], 1)).toEqual({});
  expect(outsideScope(ix, "Osero", [], 0)).toEqual({});
});
