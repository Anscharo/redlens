// prefetch.ts: deterministic pre-lookup (glossary longest-phrase match +
// entity containment) seeded as a synthetic tool round before the first LLM
// request. Pure in-memory indexes — no network, no DB.
import { describe, it, expect } from "bun:test";
import { buildIndexes, type AtlasNode, type Entity } from "./indexes.ts";
import type { Glossary, GlossaryEntry } from "../lib/glossaryLookup.ts";
import { buildPrefetch, matchGlossary, matchQuestionEntities, prefetchRound, PREFETCH_TOOL_NAME } from "./prefetch.ts";

function doc(id: string, doc_no: string, title: string): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 1, parentId: null, content: `${title} body`, order: 0, addressRefs: [] };
}
function entity(id: string, slug: string, name: string, defining_doc_id: string | null = null): Entity {
  return { id, slug, name, entity_type: "agent", subtype: null, defining_doc_id, is_active: 1, meta: null };
}
function gEntry(term: string, nodeId: string, content: string): GlossaryEntry {
  return { term, content, nodeId, docNo: "A.1", sourceDocNo: "A.1", sourceContext: null };
}

const GLOSSARY: Glossary = {
  "universal alignment": [gEntry("Universal Alignment", "d-ua", "Universal alignment is the broad idea.")],
  "universal alignment assumption": [gEntry("Universal Alignment Assumption", "d-uaa", "The assumption underlying universal alignment.")],
  "accessibility scope (acc)": [gEntry("Accessibility Scope (ACC)", "d-acc", "The scope governing accessibility.")],
  "action tenet": [gEntry("Action Tenet", "d-at", "A tenet guiding actions.")],
};

const ix = buildIndexes(
  [doc("d-ua", "A.1.1", "Universal Alignment"), doc("d-uaa", "A.1.2", "Universal Alignment Assumption"), doc("d-acc", "A.2", "Accessibility Scope"), doc("d-at", "A.3", "Action Tenet"), doc("d-spark", "A.4", "Spark Foundation Charter")],
  [entity("e-sf", "spark-foundation", "Spark Foundation", "d-spark"), entity("e-spark", "spark", "Spark"), entity("e-keel", "keel", "Keel")],
  [],
  { atlasCommit: "test" },
  null,
  GLOSSARY,
);

describe("matchGlossary", () => {
  it("matches a multi-word term with its definition", () => {
    const hits = matchGlossary(ix, "What is universal alignment?");
    expect(hits.map((h) => h.term)).toEqual(["Universal Alignment"]);
  });

  it("longest phrase wins and consumes its span (no shorter shadow match)", () => {
    const hits = matchGlossary(ix, "explain the universal alignment assumption");
    expect(hits.map((h) => h.term)).toEqual(["Universal Alignment Assumption"]);
  });

  it("matches parenthetical aliases", () => {
    const hits = matchGlossary(ix, "what is ACC responsible for");
    expect(hits.map((h) => h.term)).toEqual(["Accessibility Scope (ACC)"]);
  });

  it("matches a naive plural", () => {
    const hits = matchGlossary(ix, "list the action tenets");
    expect(hits.map((h) => h.term)).toEqual(["Action Tenet"]);
  });

  it("ignores stopwords and unrelated text", () => {
    expect(matchGlossary(ix, "how does the weather work")).toEqual([]);
  });
});

describe("matchQuestionEntities", () => {
  it("requires full name/slug containment", () => {
    const hits = matchQuestionEntities(ix, "who runs the spark foundation?");
    expect(hits.map((h) => h.slug)).toContain("spark-foundation");
  });

  it("does not drag in multi-word entities on a partial mention", () => {
    const hits = matchQuestionEntities(ix, "tell me about spark");
    expect(hits.map((h) => h.slug)).toEqual(["spark"]); // not spark-foundation
  });

  it("resolves the defining doc title", () => {
    const hit = matchQuestionEntities(ix, "spark foundation")[0];
    expect(hit.defining_doc_id).toBe("d-spark");
    expect(hit.defining_doc_title).toBe("Spark Foundation Charter");
  });
});

describe("buildPrefetch", () => {
  it("returns null when nothing matches", () => {
    expect(buildPrefetch(ix, "completely unrelated question about nothing")).toBeNull();
  });

  it("builds a JSON report with real doc UUIDs for citations", () => {
    const p = buildPrefetch(ix, "what is universal alignment and who is keel?");
    expect(p).not.toBeNull();
    const report = JSON.parse(p!.content);
    expect(report.definitions[0].doc_id).toBe("d-ua");
    expect(report.definitions[0].definition).toBe("Universal alignment is the broad idea.");
    expect(report.entities.map((e: { slug: string }) => e.slug)).toEqual(["keel"]);
    expect(p!.definitions).toBe(1);
    expect(p!.entities).toBe(1);
  });
});

describe("prefetchRound", () => {
  it("emits a well-formed assistant tool_call + tool result pair", () => {
    const p = buildPrefetch(ix, "what is universal alignment?")!;
    const [assistant, tool] = prefetchRound("what is universal alignment?", p);
    expect(assistant.role).toBe("assistant");
    const call = (assistant as { tool_calls: { id: string; function: { name: string } }[] }).tool_calls[0];
    expect(call.function.name).toBe(PREFETCH_TOOL_NAME);
    expect(tool.role).toBe("tool");
    expect((tool as { tool_call_id: string }).tool_call_id).toBe(call.id);
    expect((tool as { content: string }).content).toBe(p.content);
  });
});
