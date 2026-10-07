// Off-spec definition shapes: unit cases for the canonicalizer and slug
// matcher, then end to end through expandReferenceLinks and the streaming gate
// on the two shapes gpt-6-luna produced in the chat bakeoff.
import { test, expect } from "bun:test";
import { canonicalDefLine, citedLabels, couldBeTitledDef, matchLabelBySlug } from "./definition-line.ts";
import { expandReferenceLinks } from "./citation-normalize.ts";
import { createCitationGate } from "./definition-block-gate.ts";

const A = "a1b2c3d4-1111-2222-3333-444455556666";
const B = "b9c8d7e6-9999-8888-7777-666655554444";

test("titled definition becomes [label]: dest", () => {
  expect(canonicalDefLine(`[Core Council Buffer Multisig][council-buffer]: /atlas/${A}`))
    .toBe(`[council-buffer]: /atlas/${A}`);
});

test("bare definition becomes [Name]: dest only when the answer cites it", () => {
  const line = `Liquidity Layer Freezer Multisig: /atlas/${A}`;
  expect(canonicalDefLine(line, citedLabels("Freezers act fast. [Freezer][liquidity-layer-freezer-multisig]")))
    .toBe(`[Liquidity Layer Freezer Multisig]: /atlas/${A}`);
  expect(canonicalDefLine(line, citedLabels("No reference uses here."))).toBeNull();
  expect(canonicalDefLine(line)).toBeNull();
});

test("an unused bare line stays in the answer as prose", () => {
  const answer = `Source: /atlas/${A}\n\nThe freezer acts in emergencies.`;
  expect(expandReferenceLinks(answer).content).toBe(answer);
});

test("prose, list items, quotes, non-atlas paths and canonical lines are left alone", () => {
  for (const line of [
    `The freezer is defined here: /atlas/${A} and elsewhere.`,
    `- Freezer: /atlas/${A}`,
    `1. Freezer: /atlas/${A}`,
    `> Freezer: /atlas/${A}`,
    "Docs: /reports/multisigs",
    `Freezer: /atlas/not-a-uuid`,
    `[freezer]: /atlas/${A}`,
    `[Freezer][freezer] says the threshold is 2.`,
  ]) expect(canonicalDefLine(line)).toBeNull();
});

test("couldBeTitledDef holds only while a titled definition is still possible", () => {
  for (const s of ["[Freezer][", "[Freezer][free", "[Freezer][freezer]", "[Freezer][freezer]:"]) expect(couldBeTitledDef(s)).toBe(true);
  for (const s of ["[Freezer][freezer] says", "[Freezer](", "Freezer"]) expect(couldBeTitledDef(s)).toBe(false);
});

test("slug match: exact slug, then a unique word-boundary prefix, never an ambiguous one", () => {
  const labels = ["casting and execution of approved spell", "spell execution process"];
  expect(matchLabelBySlug("casting-and-execution", labels)).toBe(labels[0]);
  expect(matchLabelBySlug("Spell Execution Process", labels)).toBe(labels[1]);
  expect(matchLabelBySlug("cast", labels)).toBeNull(); // not a whole-word prefix
  expect(matchLabelBySlug("spell", ["spell one", "spell two"])).toBeNull();
  expect(matchLabelBySlug("casting", labels)).toBeNull(); // one word never prefix-matches
  expect(matchLabelBySlug("casting and execution", labels)).toBe(labels[0]);
});

test("titled definition block expands its uses", () => {
  const answer = [
    `[Liquidity Layer Freezer Multisig][freezer-definition]: /atlas/${A}`,
    `[Core Council Buffer Multisig Usage Standards][council-buffer]: /atlas/${B}`,
    "",
    "Freezers act in emergencies. [Freezer purpose][freezer-definition]",
    "The buffer funds the council. [Core Council Buffer purpose][council-buffer]",
  ].join("\n");
  const r = expandReferenceLinks(answer);
  expect(r.undefinedLabels).toEqual([]);
  expect(r.content).toBe([
    `Freezers act in emergencies. [Freezer purpose](/atlas/${A})`,
    `The buffer funds the council. [Core Council Buffer purpose](/atlas/${B})`,
  ].join("\n"));
});

test("bare definitions resolve their uses by slug", () => {
  const answer = [
    `Casting And Execution Of Approved Spell: /atlas/${A}`,
    "",
    "Execution is permissionless. [Casting and execution details][casting-and-execution]",
  ].join("\n");
  const r = expandReferenceLinks(answer);
  expect(r.undefinedLabels).toEqual([]);
  expect(r.content).toBe(`Execution is permissionless. [Casting and execution details](/atlas/${A})`);
});

test("streaming gate buffers a titled block and releases it canonical", () => {
  const text = `[Freezer][freezer]: /atlas/${A}\n\nFreezers act fast. [Freezer][freezer]\n`;
  const outs = [1, 2, 5, 9, text.length].map((n) => {
    const gate = createCitationGate({ render: (_t, _g, raw) => raw, repairBlock: (b) => b });
    let out = "";
    for (let i = 0; i < text.length; i += n) out += gate.push(text.slice(i, i + n));
    return out + gate.flush();
  });
  for (const out of outs) expect(out).toBe(`[freezer]: /atlas/${A}\n\nFreezers act fast. [Freezer][freezer]\n`);
});
