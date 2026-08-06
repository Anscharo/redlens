// Identifier-leak tests — real disk indexes, like the other check tests, so
// slugs resolve against actual entities.
import { test, expect } from "bun:test";
import { loadIndexes } from "../../retrieval/indexes.ts";
import { repairIdentifierLeaks } from "./identifier-leak.ts";

const ix = loadIndexes();

// An entity whose slug resolves to a real defining doc — the linkify case.
const linked = [...ix.entityBySlug.values()].find((e) => e.defining_doc_id && ix.docMap.has(e.defining_doc_id))!;
const linkedDoc = ix.docMap.get(linked.defining_doc_id!)!;
// An entity with no defining doc (Grove Labs Multisig is one) — the delete case.
const orphan = [...ix.entityBySlug.values()].find((e) => !e.defining_doc_id)!;

// The tool result that would have carried the handle into the answer — the
// atlas_entities row shape, which names the defining doc the citation lands on.
const evidence = [
  JSON.stringify({ id: linked.id, slug: linked.slug, name: linked.name, defining_doc_id: linked.defining_doc_id }),
];

test("a leaked slug links the name the prose already wrote", () => {
  const r = repairIdentifierLeaks(`- **${linked.name}**: (Slug: ${linked.slug})`, evidence, ix);
  expect(r.content).toBe(`- **[${linked.name}](/atlas/${linkedDoc.id})**`);
  expect(r.linkified).toEqual([`${linked.slug} → ${linkedDoc.doc_no}`]);
  expect(r.removed).toEqual([]);
});

test("mid-sentence, the leak becomes a standalone citation", () => {
  const r = repairIdentifierLeaks(`Grove signs there (slug: ${linked.slug}) every quarter.`, evidence, ix);
  expect(r.content).toBe(`Grove signs there ([${linked.name}](/atlas/${linkedDoc.id})) every quarter.`);
});

test("a slug whose doc was NOT retrieved is deleted with its separator", () => {
  const r = repairIdentifierLeaks(`- **${linked.name}**: (Slug: ${linked.slug})`, [], ix);
  expect(r.content).toBe(`- **${linked.name}**`);
  expect(r.removed).toEqual([linked.slug]);
  expect(r.linkified).toEqual([]);
});

test("a slug with no defining doc is deleted even when its entity is in evidence", () => {
  const ev = [JSON.stringify({ id: orphan.id, slug: orphan.slug })];
  const r = repairIdentifierLeaks(`Grove also uses ${orphan.name} (slug: ${orphan.slug}).`, ev, ix);
  expect(r.content).toBe(`Grove also uses ${orphan.name}.`);
  expect(r.removed).toEqual([orphan.slug]);
});

test("id/uuid/entity_type keys leak the same way; a bare uuid handle resolves", () => {
  const r = repairIdentifierLeaks(`See it (uuid: ${linkedDoc.id}) and (entity_type: multisig).`, [linkedDoc.id], ix);
  expect(r.content).toBe(`See it ([${linkedDoc.title}](/atlas/${linkedDoc.id})) and.`);
  expect(r.removed).toEqual(["multisig"]);
});

test("legitimate parentheticals survive untouched", () => {
  const answer =
    "Grove (Prime Agent) holds 0xb30fe1cf884b48a22a50d22a9282004f2c5e9406 (Ethereum).\n" +
    "Grove Labs Multisig (Ecosystem Actor) is not a signer (see below).";
  expect(repairIdentifierLeaks(answer, evidence, ix)).toMatchObject({ content: answer, linkified: [], removed: [] });
});

test("an already-linked name is not nested — the citation stands alone", () => {
  const answer = `- [${linked.name}](/atlas/${linkedDoc.id}): (slug: ${linked.slug})`;
  const r = repairIdentifierLeaks(answer, evidence, ix);
  expect(r.content).toBe(`- [${linked.name}](/atlas/${linkedDoc.id}): ([${linked.name}](/atlas/${linkedDoc.id}))`);
});

test("code spans, fenced code and blockquotes are left verbatim", () => {
  const answer =
    "Call `atlas_entity(slug: grove)` to resolve it.\n" +
    "```\natlas_edges(from_slug: grove)\n```\n" +
    "> The Freezer Multisig (slug: grove-freezer-multisig) is named in the atlas.";
  expect(repairIdentifierLeaks(answer, evidence, ix).content).toBe(answer);
});

test("prose about slugs is not a leak", () => {
  const answer = `The entity's slug is ${linked.slug}, which the tools accept as a name.`;
  expect(repairIdentifierLeaks(answer, evidence, ix).content).toBe(answer);
});

test("a line-leading bullet dash is never eaten as a separator", () => {
  expect(repairIdentifierLeaks(`- (slug: ${orphan.slug})`, [], ix).content).toBe("-");
});

test("answers with no parenthetical come back byte-identical", () => {
  const answer = "Grove is a Prime Agent.\n\nIt holds three multisigs.";
  expect(repairIdentifierLeaks(answer, [], ix).content).toBe(answer);
});
