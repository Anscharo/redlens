// prefetch.ts: deterministic pre-lookup (glossary longest-phrase match +
// entity containment) seeded as a synthetic tool round before the first LLM
// request. Pure in-memory indexes — no network, no DB.
import { describe, it, expect } from "bun:test";
import { buildIndexes, type AtlasNode, type Entity } from "./retrieval/indexes.ts";
import type { Glossary, GlossaryEntry } from "../lib/glossaryLookup.ts";
import { buildPrefetch, matchGlossary, matchQuestionEntities, prefetchRound, PREFETCH_TOOL_NAME } from "./prefetch.ts";

function doc(id: string, doc_no: string, title: string): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 1, parentId: null, content: `${title} body`, order: 0, addressRefs: [] };
}
function entity(id: string, slug: string, name: string, defining_doc_id: string | null = null, entity_type = "agent", subtype: string | null = null, meta: object | null = null): Entity {
  return { id, slug, name, entity_type, subtype, defining_doc_id, is_active: 1, meta: meta ? JSON.stringify(meta) : null };
}
function gEntry(term: string, nodeId: string, content: string): GlossaryEntry {
  return { term, content, nodeId, docNo: "A.1", sourceDocNo: "A.1", sourceContext: null };
}

const GLOSSARY: Glossary = {
  "universal alignment": [gEntry("Universal Alignment", "d-ua", "Universal alignment is the broad idea.")],
  "universal alignment assumption": [gEntry("Universal Alignment Assumption", "d-uaa", "The assumption underlying universal alignment.")],
  "accessibility scope (acc)": [gEntry("Accessibility Scope (ACC)", "d-acc", "The scope governing accessibility.")],
  "action tenet": [gEntry("Action Tenet", "d-at", "A tenet guiding actions.")],
  facilitator: [gEntry("Facilitator", "d-fac", "Facilitators are anonymous alignment conservers.")],
};

const ix = buildIndexes(
  [
    doc("d-ua", "A.1.1", "Universal Alignment"),
    doc("d-uaa", "A.1.2", "Universal Alignment Assumption"),
    doc("d-acc", "A.2", "Accessibility Scope"),
    doc("d-at", "A.3", "Action Tenet"),
    doc("d-spark", "A.4", "Spark Foundation Charter"),
    doc("d-redline", "A.5", "Operational Executor Facilitator"),
    doc("d-spark-agent", "A.6", "Spark"),
    doc("d-alm", "A.6.1", "Asset Liability Management Rental Primitive"),
    doc("d-fac", "A.7", "Facilitator"),
  ],
  [
    entity("e-sf", "spark-foundation", "Spark Foundation", "d-spark", "foundation"),
    entity("e-spark", "spark", "Spark", null, "agent", "prime"),
    entity("e-keel", "keel", "Keel"),
    entity("e-redline", "redline-facilitation-group", "Redline Facilitation Group", "d-redline", "facilitator_org", null, { aliases: ["Redline"] }),
    entity(
      "e-alm-spark",
      "spark-asset-liability-management-rental",
      "Asset Liability Management Rental Primitive",
      "d-alm",
      "primitive",
      "asset-liability-management-rental",
      { agent_doc_id: "d-spark-agent" },
    ),
    // Raw (non-JSON.stringify'd) meta: ownerAgentName's JSON.parse must fail
    // closed (null agent, not a thrown error) on a malformed row rather than
    // taking down the whole prefetch lookup for every entity in the response.
    { id: "e-glitch", slug: "glitch-primitive", name: "Glitch Primitive", entity_type: "primitive", subtype: null, defining_doc_id: null, is_active: 1, meta: "{not valid json" },
  ],
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

  it("tolerates a single-character typo on a longer word", () => {
    const hits = matchGlossary(ix, "what is a faciliator"); // missing "t"
    expect(hits.map((h) => h.term)).toEqual(["Facilitator"]);
  });

  it("does not fuzzy-match multi-word phrases (unigrams only)", () => {
    // 1 edit from "action tenet" is nowhere close in edit distance as a whole
    // phrase; fuzzy only ever considers single-word keys.
    expect(matchGlossary(ix, "explain action tenett")).toEqual([]);
  });

  it("does not fuzzy-match short words (<=4 chars must be exact)", () => {
    // "acc" → "acc" alias is exact already; a genuine 1-edit-off short token
    // ("acd") must not resolve — too easy to collide at that length.
    expect(matchGlossary(ix, "what is acd")).toEqual([]);
  });

  it("exact match still wins over a coincidental fuzzy candidate", () => {
    const hits = matchGlossary(ix, "what is a facilitator");
    expect(hits.map((h) => h.term)).toEqual(["Facilitator"]);
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

  it("labels the entity kind from entity_type + subtype", () => {
    const hit = matchQuestionEntities(ix, "tell me about spark")[0];
    expect(hit.kind).toBe("Prime Agent");
  });

  it("resolves the defining doc title", () => {
    const hit = matchQuestionEntities(ix, "spark foundation")[0];
    expect(hit.defining_doc_id).toBe("d-spark");
    expect(hit.defining_doc_title).toBe("Spark Foundation Charter");
  });

  it("finds an entity by a recorded short-name alias, not just its full name", () => {
    const hits = matchQuestionEntities(ix, "who is redline");
    expect(hits.map((h) => h.slug)).toEqual(["redline-facilitation-group"]);
    expect(hits[0].defining_doc_title).toBe("Operational Executor Facilitator");
  });

  it("resolves the owning Prime Agent for one-per-agent primitive/instance/invocation entities", () => {
    const hit = matchQuestionEntities(ix, "asset liability management rental primitive")[0];
    expect(hit.slug).toBe("spark-asset-liability-management-rental");
    expect(hit.agent).toBe("Spark");
  });

  it("leaves agent null for entity types that aren't one-per-agent", () => {
    const hit = matchQuestionEntities(ix, "tell me about spark")[0];
    expect(hit.agent).toBeNull();
  });

  it("leaves agent null (not a thrown error) when an agent-scoped entity's meta is malformed JSON", () => {
    const hit = matchQuestionEntities(ix, "glitch primitive")[0];
    expect(hit.slug).toBe("glitch-primitive");
    expect(hit.agent).toBeNull();
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

describe("census lane (concepts-prefetch)", () => {
  it("injects a census summary for census-vocabulary questions", () => {
    const p = buildPrefetch(ix, "how many registries are actually empty?");
    expect(p).not.toBeNull();
    const report = JSON.parse(p!.content);
    expect(p!.censuses).toBe(1);
    expect(report.censuses[0].slug).toBe("registry-liveness");
    expect(report.censuses[0].counts).toBeDefined();
    expect(report.censuses[0].members).toBeUndefined(); // counts only — drill-down is a tool call
    expect(report.censuses[0].members_hint).toContain('censuses:registry-liveness');
    expect(report.censuses_note).toContain("our census shows");
  });

  it("does not fire on ordinary doc-lookup phrasing", () => {
    for (const q of ["list of prime agents", "what is universal alignment?", "who is keel?"]) {
      const p = buildPrefetch(ix, q);
      if (p) {
        expect(p.censuses).toBe(0);
        expect(JSON.parse(p.content).censuses).toBeUndefined();
      }
    }
  });

  it("caps a many-vocabulary question at three censuses", () => {
    const p = buildPrefetch(ix, "do registries, document types, duplicated titles, formulas or prohibitions overlap?");
    expect(p!.censuses).toBe(3);
  });
});
