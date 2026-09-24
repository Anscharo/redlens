import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { buildCiteRequest, judgeCitation, scopedToClause, CITE_QUESTION } from "./cite-support.ts";
import { citationPairs } from "./cite-pairs.ts";
import { claimSegments } from "./verify-checks.ts";
import { config } from "../../config.ts";
import type { Indexes } from "../../retrieval/indexes.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const KID = "33333333-3333-4333-8333-333333333333";

const node = (id: string, title: string, content: string, parentId: string | null = null) =>
  ({ id, title, content, parentId, doc_no: "A.1", type: "Core", depth: 1, order: 0, addressRefs: [] }) as any;

const ix = {
  docMap: new Map([
    [A, node(A, "Facilitator", "Facilitators are contracted by Executor Agents.")],
    [B, node(B, "Rate Limits", "Rate limits apply to the instance.")],
    [KID, node(KID, "Child", "The child carries the detail.", A)],
  ]),
  childrenIndex: new Map([[A, [node(KID, "Child", "The child carries the detail.", A)]]]),
} as unknown as Indexes;

const realFetch = globalThis.fetch;
const realKey = config.openrouterApiKey;
beforeEach(() => {
  config.openrouterApiKey = "test-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.openrouterApiKey = realKey;
});

describe("citationPairs", () => {
  it("pairs a sentence with the doc it links, stripping the link markup", () => {
    const pairs = citationPairs(`Facilitators are contracted by agents [Facilitator](/atlas/${A}).`);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].uuid).toBe(A);
    // The link TEXT is usually the doc's own title — leaving it in would beg
    // the question the judge is asked.
    expect(pairs[0].claim).not.toContain("Facilitator]");
    expect(pairs[0].claim).toContain("contracted by agents");
  });

  it("emits one pair per citation when a sentence cites two docs", () => {
    const pairs = citationPairs(`Both apply here [One](/atlas/${A}) and [Two](/atlas/${B}).`);
    expect(pairs.map((p) => p.uuid).sort()).toEqual([A, B].sort());
    expect(new Set(pairs.map((p) => p.claim)).size).toBe(1); // same claim, two docs
  });

  it("shares segmentation with the lexical check — blockquotes and headings are skipped by both", () => {
    const quoted = `> A quoted line [Facilitator](/atlas/${A}).`;
    expect(claimSegments(quoted)).toEqual([]);
    expect(citationPairs(quoted)).toEqual([]);
    expect(citationPairs(`## Heading [Facilitator](/atlas/${A})`)).toEqual([]);
  });

  it("de-duplicates a repeated (claim, doc) pair", () => {
    const line = `The same claim repeated [X](/atlas/${A}).`;
    expect(citationPairs(`${line}\n${line}`)).toHaveLength(1);
  });

  it("returns nothing for prose with no citation", () => {
    expect(citationPairs("Just a sentence with no link at all.")).toEqual([]);
  });
});

describe("buildCiteRequest", () => {
  it("puts the claim and the cited doc in named state", () => {
    const req = buildCiteRequest({ claim: "c", uuid: A }, ix)!;
    const state = req.state as any;
    expect(state.claim).toBe("c");
    expect(state.cited_doc.title).toBe("Facilitator");
    expect(state.cited_doc.children).toBeUndefined();
    expect(req.questions.support).toBe(CITE_QUESTION);
  });

  it("returns null for an unknown uuid rather than inventing a document", () => {
    expect(buildCiteRequest({ claim: "c", uuid: "99999999-9999-4999-8999-999999999999" }, ix)).toBeNull();
  });

  // A pair with no context must produce the request it has ALWAYS produced —
  // same state keys, same question object by identity. That is what keeps the
  // clause change inert for single-citation sentences and keeps the bakeoff's
  // disk cache hitting on them.
  it("a pair with no context gets the unchanged question by identity, and no sentence field", () => {
    const req = buildCiteRequest({ claim: "c", uuid: A }, ix)!;
    expect(req.questions.support).toBe(CITE_QUESTION);
    expect((req.state as Record<string, unknown>).sentence).toBeUndefined();
  });

  it("a pair WITH context gets the sentence and a clause-scoped question", () => {
    const req = buildCiteRequest({ claim: "and the setup of Executor Accords", uuid: A, context: "They validate agent creation and the setup of Executor Accords" }, ix)!;
    const state = req.state as Record<string, unknown>;
    expect(state.sentence).toBe("They validate agent creation and the setup of Executor Accords");
    const q = req.questions.support;
    expect(q).not.toBe(CITE_QUESTION); // never mutates the shared question
    expect(q.instructions).toContain("Judge ONLY `claim`");
    expect(q.instructions).toContain(CITE_QUESTION.instructions); // criteria + base intent preserved
    expect(q.criteria).toEqual(CITE_QUESTION.criteria);
  });

  // The two arrive together or not at all: state the model has no instruction
  // for is worse than no state.
  it("scopedToClause derives from whichever base question is in play", () => {
    const three = { type: "choice" as const, instructions: "base.", criteria: { supports: "s", contradicts: "c", says_nothing: "n" } };
    const scoped = scopedToClause(three);
    expect(Object.keys(scoped.criteria)).toEqual(["supports", "contradicts", "says_nothing"]);
    expect(scoped.instructions.startsWith("base.")).toBe(true);
  });
});

describe("judgeCitation", () => {
  const answering = (body: unknown, status = 200) => {
    globalThis.fetch = (async () =>
      status === 200 ? new Response(JSON.stringify(body), { status }) : new Response("boom", { status })) as unknown as typeof fetch;
  };

  it("returns the verdict with its distribution", async () => {
    answering({
      answers: { support: { type: "choice", choice: "contradicts", probabilities: { contradicts: 0.9, supports: 0.1, says_nothing: 0 }, confidence: 0.88 } },
      usage: { input_tokens: 443, output_tokens: 44, cost: 0.0000186 },
      id: "gen-dec-1",
    });
    const j = await judgeCitation({ pair: { claim: "c", uuid: A }, ix });
    expect(j.verdict).toBe("contradicts");
    expect(j.confidence).toBe(0.88);
    expect(j.probabilities?.contradicts).toBe(0.9);
    expect(j.costUsd).toBe(0.0000186);
  });

  // This check can only ever ADD a finding, so a failure must mean "no
  // finding" — never a fabricated contradiction.
  it("fails OPEN on a transport error", async () => {
    answering(null, 500);
    expect((await judgeCitation({ pair: { claim: "c", uuid: A }, ix, timeoutMs: 700 })).verdict).toBeNull();
  });

  it("fails open on an answer of the wrong type or an unknown option", async () => {
    answering({ answers: { support: { type: "noul", noul: 0.9 } }, id: "g" });
    expect((await judgeCitation({ pair: { claim: "c", uuid: A }, ix })).verdict).toBeNull();
    answering({ answers: { support: { type: "choice", choice: "maybe", probabilities: {}, confidence: 1 } }, id: "g" });
    expect((await judgeCitation({ pair: { claim: "c", uuid: A }, ix })).verdict).toBeNull();
  });

  it("fails open for an unknown uuid without making a request", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect((await judgeCitation({ pair: { claim: "c", uuid: "44444444-4444-4444-8444-444444444444" }, ix })).verdict).toBeNull();
    expect(called).toBe(false);
  });
});
