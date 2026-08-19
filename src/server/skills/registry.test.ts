// skills/registry.ts: which skills fire for a turn, and the synthetic tool
// round they are injected as. Pure in-memory indexes — no network, no DB.
import { describe, it, expect } from "bun:test";
import { buildIndexes, type AtlasNode, type Entity } from "../retrieval/indexes.ts";
import type { Glossary, GlossaryEntry } from "../../lib/glossaryLookup.ts";
import { runSkills, skillRound, SKILLS, SKILL_TOOL_NAME } from "./registry.ts";

function doc(id: string, doc_no: string, title: string): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 1, parentId: null, content: `${title} body`, order: 0, addressRefs: [] };
}
function gEntry(term: string, nodeId: string, content: string): GlossaryEntry {
  return { term, content, nodeId, docNo: "A.1", sourceDocNo: "A.1", sourceContext: null };
}

const GLOSSARY: Glossary = {
  "universal alignment": [gEntry("Universal Alignment", "d-ua", "Universal alignment is the broad idea.")],
};

const ix = buildIndexes(
  [doc("d-ua", "A.1.1", "Universal Alignment"), doc("d-keel", "A.2", "Keel")],
  [{ id: "e-keel", slug: "keel", name: "Keel", entity_type: "agent", subtype: null, defining_doc_id: "d-keel", is_active: 1, meta: null } satisfies Entity],
  [],
  {},
  null,
  GLOSSARY,
);

const report = (question: string, page?: { path?: string }) => {
  const out = runSkills({ ix, question, page });
  return out ? { counts: out.counts, json: JSON.parse(out.content) } : null;
};

describe("runSkills", () => {
  it("returns null when no skill fires", () => {
    expect(runSkills({ ix, question: "completely unrelated question about nothing" })).toBeNull();
  });

  it("injects only the skills that fired, each under its own key", () => {
    const r = report("what is universal alignment and who is keel?")!;
    expect(r.json.definitions[0].doc_id).toBe("d-ua");
    expect(r.json.entities.map((e: { slug: string }) => e.slug)).toEqual(["keel"]);
    expect(r.counts).toEqual({ glossary: 1, entities: 1 });
    // Skills that did not fire leave no empty shell behind.
    expect(r.json.censuses).toBeUndefined();
    expect(r.json.app_features).toBeUndefined();
  });

  it("carries a skill's handling note as <key>_note", () => {
    const r = report("how many registries are actually empty?")!;
    expect(r.counts.censuses).toBe(1);
    expect(r.json.censuses[0].slug).toBe("registry-liveness");
    expect(r.json.censuses[0].members).toBeUndefined(); // counts only — drill-down is a tool call
    expect(r.json.censuses_note).toContain("our census shows");
  });

  it("caps a many-vocabulary question at three censuses", () => {
    const r = report("do registries, document types, duplicated titles, formulas or prohibitions overlap?")!;
    expect(r.counts.censuses).toBe(3);
  });

  it("does not fire the census lane on ordinary doc-lookup phrasing", () => {
    for (const q of ["list of prime agents", "what is universal alignment?", "who is keel?"]) {
      const r = report(q);
      if (r) expect(r.counts.censuses).toBeUndefined();
    }
  });

  it("gives every registered skill a unique id and a description", () => {
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(SKILLS.length);
    for (const s of SKILLS) expect(s.what.length).toBeGreaterThan(20);
  });
});

describe("skillRound", () => {
  it("emits a well-formed assistant tool_call + tool result pair", () => {
    const injection = runSkills({ ix, question: "what is universal alignment?" })!;
    const [assistant, tool] = skillRound("what is universal alignment?", injection);
    expect(assistant.role).toBe("assistant");
    const call = (assistant as { tool_calls: { id: string; function: { name: string } }[] }).tool_calls[0];
    expect(call.function.name).toBe(SKILL_TOOL_NAME);
    expect(tool.role).toBe("tool");
    expect((tool as { tool_call_id: string }).tool_call_id).toBe(call.id);
    expect((tool as { content: string }).content).toBe(injection.content);
  });
});

describe("features skill, through the registry", () => {
  it("fires on a page-context trigger with no capability wording in the question", () => {
    const r = report("what does this cover?", { path: "/features" })!;
    expect(r.counts.features).toBeGreaterThan(0);
    expect(r.json.app_features.app.length).toBeGreaterThan(0);
  });

  it("stays out of an ordinary atlas question", () => {
    const r = report("what is universal alignment?")!;
    expect(r.json.app_features).toBeUndefined();
  });
});
