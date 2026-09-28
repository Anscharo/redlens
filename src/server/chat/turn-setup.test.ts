// prepareTurn characterization. `legacyAssemble` below is chat.ts's pre-first-
// token assembly copied verbatim from before the extraction (commit d5a4d866,
// the non-/teach path), with one change: the Jev call is a parameter so both
// sides get the same fake. prepareTurn must reproduce it exactly — same
// messages, same route, same model chain and round budget — for every shape of
// turn the route sees. The route itself is covered end to end by chat.test.ts;
// this pins the assembly the eval reuses.
import { afterAll, beforeAll, describe, expect, it, setSystemTime } from "bun:test";
import type OpenAI from "openai";
import { config } from "../config.ts";
import { loadIndexes, type Indexes } from "../retrieval/indexes.ts";
import { CENSUS_SLUGS, type CensusSlug } from "../../lib/conceptsCensus.ts";
import { routeTier, resolveTierModels, citationStyleFor, iterationsForTier } from "./model-router.ts";
import { buildSystemPrompt, type PageContext } from "./system-prompt.ts";
import { runFacts, factRound } from "../facts/registry.ts";
import { windowHistory } from "./chat-history.ts";
import { filterTeachingsByJev, type PrefetchJudgement, type judgePrefetch } from "./prefetch-judge.ts";
import { teachingRound } from "./teach/inject.ts";
import type { RankedTeaching } from "./teach/match.ts";
import { disputeRound } from "./dispute-round.ts";
import type { AgreedContradiction } from "./verify/disputes.ts";
import { prepareTurn } from "./turn-setup.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Judge = typeof judgePrefetch;
type Row = { role: string; content: string };

async function legacyAssemble(ix: Indexes, message: string, history: Row[], pageContext: PageContext | undefined, teachHits: RankedTeaching[], judgePrefetch: Judge) {
  const judgement = config.chatPrefetchJudgeModel
    ? await judgePrefetch({ question: message, notes: teachHits.map((h) => ({ id: h.id, subject: h.subject, content: h.content })) })
    : null;
  const priorAssistants = history.filter((m) => m.role === "assistant").length;
  const route = routeTier(message, { followUp: priorAssistants > 0, jevComplexity: judgement?.complexity });
  const models = resolveTierModels(route.tier);
  const maxIterations = iterationsForTier(route.tier);
  const messages: Msg[] = [
    { role: "system", content: buildSystemPrompt(ix, pageContext, citationStyleFor(models[0]), undefined, maxIterations) },
    ...windowHistory(history).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];
  const facts = config.chatPrefetch ? runFacts({ ix, question: message, page: pageContext, jevCensus: judgement?.census }) : null;
  if (facts) messages.push(...factRound(message, facts));
  const keptTeachings = filterTeachingsByJev(teachHits, judgement);
  const teachings = keptTeachings.length > 0 ? keptTeachings : null;
  if (teachings) messages.push(...teachingRound(message, teachings));
  return { route, models, maxIterations, messages, facts, judgement, teachings };
}

function fakeJudge(complexity: number | null, census: Partial<Record<CensusSlug, number>> = {}, teach: Record<string, number> = {}): Judge {
  const full = Object.fromEntries(CENSUS_SLUGS.map((s) => [s, census[s] ?? 0.05])) as Record<CensusSlug, number>;
  const j: PrefetchJudgement = { complexity, census: full, teach, latencyMs: 1, costUsd: 0, generationId: null };
  return async () => j;
}
const failedJudge: Judge = async () => null;

const note = (id: string, content: string): RankedTeaching => ({ id, subject: "spark", content, score: 0.9, lex: 0.5, ternlight: 0.9 });

describe("prepareTurn", () => {
  let ix: Indexes;
  const saved = { strong: config.chatModelStrong, fallbacks: config.chatModelFallbacks, judge: config.chatPrefetchJudgeModel, prefetch: config.chatPrefetch };
  beforeAll(() => {
    ix = loadIndexes();
    setSystemTime(new Date("2026-09-22T12:00:00Z")); // both sides build the same dated prompt
    config.chatModelStrong = ["openai/gpt-5.6-luna"]; // reference-citation model: the strong prompt differs
    config.chatModelFallbacks = ["z-ai/glm-5.2"];
    config.chatPrefetchJudgeModel = "typesafe/jev-test";
  });
  afterAll(() => {
    setSystemTime();
    config.chatModelStrong = saved.strong;
    config.chatModelFallbacks = saved.fallbacks;
    config.chatPrefetchJudgeModel = saved.judge;
    config.chatPrefetch = saved.prefetch;
  });

  const node = () => [...ix.docMap.values()].find((d) => d.doc_no === "A.1.9")!;
  const cases: { name: string; message: string; history?: Row[]; page?: () => PageContext; teach?: RankedTeaching[]; judge: Judge }[] = [
    { name: "plain first turn", message: "How does the Stability Scope handle collateral onboarding?", judge: fakeJudge(0.1) },
    { name: "follow-up", message: "what about its threshold?", history: [{ role: "user", content: "What is the Spark Freezer Multisig?" }, { role: "assistant", content: "It is a multisig.\n\nMore." }], judge: fakeJudge(0.1) },
    { name: "node page, features fact", message: "what can this app do?", page: () => ({ path: "/atlas", nodeId: node().id, nodeTitle: node().title, nodeDocNo: node().doc_no }), judge: fakeJudge(0.1) },
    { name: "report page with filter", message: "which of these apply to Spark?", page: () => ({ path: "/reports/of-responsibilities", reportName: "Operational Facilitator Responsibilities", reportTool: "atlas_report_facilitator_responsibilities", reportFilter: "spark" }), judge: fakeJudge(0.2) },
    { name: "Jev routes strong", message: "What are the facilitators?", judge: fakeJudge(0.9) },
    { name: "Jev census fires", message: "which doc types are never used?", judge: fakeJudge(0.3, { "ghost-doc-types": 0.9 }) },
    { name: "teach notes, one filtered", message: "Who signs for the Spark freezer multisig?", teach: [note("t1", "Spark freezer signers are listed in the Spark artifact."), note("t2", "Freezers pause.")], judge: fakeJudge(0.2, {}, { t1: 0.9, t2: 0.1 }) },
    { name: "Jev failed", message: "What is the Emergency Response System?", teach: [note("t1", "ERS lives in the Governance Scope.")], judge: failedJudge },
  ];

  for (const c of cases) {
    it(`matches the pre-extraction assembly: ${c.name}`, async () => {
      const history = [...(c.history ?? []), { role: "user", content: c.message }];
      const page = c.page?.();
      const want = await legacyAssemble(ix, c.message, history, page, c.teach ?? [], c.judge);
      const got = await prepareTurn({ ix, message: c.message, history, pageContext: page, teachHits: c.teach, judge: c.judge });
      expect(got.messages).toEqual(want.messages);
      expect(got.route).toEqual(want.route);
      expect(got.routed).toEqual(want.route);
      expect(got.models).toEqual(want.models);
      expect(got.maxIterations).toBe(want.maxIterations);
      expect(got.facts).toEqual(want.facts);
      expect(got.judgement).toEqual(want.judgement);
      expect(got.teachings).toEqual(want.teachings);
    });
  }

  it("the cases above exercise both tiers, facts, a census and a filtered note", async () => {
    const strong = await prepareTurn({ ix, message: "What are the facilitators?", history: [{ role: "user", content: "What are the facilitators?" }], judge: fakeJudge(0.9) });
    expect(strong.route).toEqual({ tier: "strong", reason: "jev" });
    expect(strong.models[0]).toBe("openai/gpt-5.6-luna");
    const teach = await prepareTurn({ ix, message: cases[6].message, history: [{ role: "user", content: cases[6].message }], teachHits: cases[6].teach, judge: cases[6].judge });
    expect(teach.teachings?.map((t) => t.id)).toEqual(["t1"]);
  });

  it("forceTier runs the forced chain with its own prompt, and still reports the routed tier", async () => {
    const message = "What are the facilitators?";
    const got = await prepareTurn({ ix, message, history: [{ role: "user", content: message }], judge: fakeJudge(0.9), forceTier: "default" });
    expect(got.routed).toEqual({ tier: "strong", reason: "jev" });
    expect(got.route).toEqual({ tier: "default", reason: "forced" });
    expect(got.models).toEqual(resolveTierModels("default"));
    expect(got.maxIterations).toBe(iterationsForTier("default"));
    expect(got.messages[0].content).toBe(buildSystemPrompt(ix, undefined, citationStyleFor(got.models[0]), undefined, got.maxIterations));
  });

  it("a disabled judge is never called, and CHAT_PREFETCH=0 injects no facts round", async () => {
    config.chatPrefetchJudgeModel = "";
    config.chatPrefetch = false;
    try {
      let called = false;
      const judge: Judge = async () => { called = true; return null; };
      const got = await prepareTurn({ ix, message: "what can this app do?", history: [{ role: "user", content: "what can this app do?" }], judge });
      expect(called).toBe(false);
      expect(got.facts).toBeNull();
      expect(got.messages.map((m) => m.role)).toEqual(["system", "user"]);
    } finally {
      config.chatPrefetchJudgeModel = "typesafe/jev-test";
      config.chatPrefetch = saved.prefetch;
    }
  });

  describe("dispute round", () => {
    const contradiction: AgreedContradiction = {
      answer: "They carry out operational activities on behalf of the Prime Agents they serve.",
      evidence: "GovOps actors carry out operational activities on behalf of Executor Agents.",
      why: "Subject mismatch.",
      uuid: "76405733-0000-0000-0000-000000000000",
    };

    it("inserts the dispute round right after history and before facts, when disputes are passed", async () => {
      const message = "are you sure about that dispute? i think the question is who is \"they\"";
      const history = [
        { role: "user", content: "who does GovOps act for?" },
        { role: "assistant", content: contradiction.answer },
        { role: "user", content: message },
      ];
      const got = await prepareTurn({ ix, message, history, judge: fakeJudge(0.1), disputes: [contradiction] });
      const want = disputeRound([contradiction]);
      // messages[0] = system, [1..3] = the three history rows above, then the
      // dispute round — whatever else (facts, teach) may follow it.
      expect(got.messages.slice(4, 4 + want.length)).toEqual(want);
    });

    it("injects nothing when disputes is empty or omitted, and matches the pre-extraction assembly exactly", async () => {
      const message = "What are the facilitators?";
      const history = [{ role: "user", content: message }];
      const want = await legacyAssemble(ix, message, history, undefined, [], fakeJudge(0.9));
      const omitted = await prepareTurn({ ix, message, history, judge: fakeJudge(0.9) });
      const empty = await prepareTurn({ ix, message, history, judge: fakeJudge(0.9), disputes: [] });
      expect(omitted.messages).toEqual(want.messages);
      expect(empty.messages).toEqual(want.messages);
    });
  });
});
