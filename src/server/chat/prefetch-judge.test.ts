// prefetch-judge.ts: the ONE pre-first-token Jev request, its three shipped
// thresholds, and the teach shortlist filter that reads one of them. Stubbed
// fetch throughout — askJev refuses without a key, and CI has none.
import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import {
  judgePrefetch,
  filterTeachingsByJev,
  JEV_COMPLEXITY_THRESHOLD,
  JEV_CENSUS_THRESHOLD,
  JEV_TEACH_THRESHOLD,
  type PrefetchJudgement,
} from "./prefetch-judge.ts";
import { everySlugHasAQuestion } from "./prefetch-questions.ts";
import { CENSUS_SLUGS, type CensusSlug } from "../../lib/conceptsCensus.ts";
import { config } from "../config.ts";
import type { RankedTeaching } from "./teach/match.ts";

const realFetch = globalThis.fetch;
const realKey = config.openrouterApiKey;
let lastBody: any = null;
beforeEach(() => {
  config.openrouterApiKey = "test-key";
  lastBody = null;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.openrouterApiKey = realKey;
});

const emptyCensus = (): Record<CensusSlug, number> =>
  Object.fromEntries(CENSUS_SLUGS.map((s) => [s, 0])) as Record<CensusSlug, number>;

/** Answers every question the request actually asked, 0.05 unless overridden by id. */
function answering(overrides: Record<string, number> = {}, status = 200) {
  globalThis.fetch = (async (_url: any, init: any) => {
    lastBody = JSON.parse(init.body);
    if (status !== 200) return new Response("nope", { status });
    const answers: Record<string, unknown> = {};
    for (const id of Object.keys(lastBody.questions)) {
      const p = overrides[id];
      answers[id] = p === undefined ? { type: "noul", noul: 0.05 } : { type: "noul", noul: p };
    }
    return new Response(
      JSON.stringify({ answers, usage: { input_tokens: 500, output_tokens: 40, cost: 0.00003 }, id: "gen-prefetch-1" }),
      { status: 200 },
    );
  }) as typeof fetch;
}

// Never resolves except on abort — proves the deadline is a genuine wall
// clock, not something that depends on the transport cooperating.
function hanging() {
  globalThis.fetch = (async (_url: any, init: any) => {
    return new Promise<Response>((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  }) as typeof fetch;
}

describe("judgePrefetch — request shape", () => {
  it("carries complexity + one Noul per census slug + one per note, as a RECORD (never an array — the API 400s on one)", async () => {
    answering();
    await judgePrefetch({
      question: "what changed recently?",
      notes: [
        { id: "n1", subject: "S1", content: "C1" },
        { id: "n2", subject: null, content: "C2" },
      ],
    });
    expect(Array.isArray(lastBody.questions)).toBe(false);
    const keys = Object.keys(lastBody.questions);
    expect(keys).toContain("complexity");
    for (const slug of CENSUS_SLUGS) expect(keys).toContain(slug);
    expect(keys).toContain("teach:n1");
    expect(keys).toContain("teach:n2");
    expect(keys).toHaveLength(1 + CENSUS_SLUGS.length + 2);
    expect(lastBody.questions.complexity.type).toBe("noul");
  });

  it("truncates the message to 2000 chars and sends notes as subject+content only (no id)", async () => {
    answering();
    await judgePrefetch({ question: "x".repeat(3000), notes: [{ id: "n1", subject: "S", content: "C" }] });
    expect(lastBody.state.message).toHaveLength(2000);
    expect(lastBody.state.notes).toEqual([{ subject: "S", content: "C" }]);
  });

  it("omits `notes` from state entirely when there are none", async () => {
    answering();
    await judgePrefetch({ question: "hi", notes: [] });
    expect("notes" in lastBody.state).toBe(false);
  });

  it("addresses each note's Noul by its index into the SAME notes array sent in state", async () => {
    answering();
    await judgePrefetch({
      question: "q",
      notes: [
        { id: "a", subject: null, content: "A" },
        { id: "b", subject: null, content: "B" },
      ],
    });
    expect(lastBody.questions["teach:a"].instructions).toContain("notes[0]");
    expect(lastBody.questions["teach:b"].instructions).toContain("notes[1]");
  });
});

describe("judgePrefetch — parsing", () => {
  it("returns the complexity Noul and every census slug's Noul", async () => {
    answering({ complexity: 0.71, "registry-liveness": 0.9 });
    const j = await judgePrefetch({ question: "q", notes: [] });
    expect(j?.complexity).toBe(0.71);
    expect(j?.census["registry-liveness"]).toBe(0.9);
    expect(j?.census["formula-docs"]).toBe(0.05); // answered, just not overridden above
  });

  it("defaults a census slug to 0 when its Noul fails to parse — a miss can never be a false fire", async () => {
    globalThis.fetch = (async (_url: any, init: any) => {
      lastBody = JSON.parse(init.body);
      const answers: Record<string, unknown> = { complexity: { type: "noul", noul: 0.1 } };
      for (const slug of CENSUS_SLUGS) {
        answers[slug] = slug === "formula-docs" ? { type: "choice", choice: "x" } : { type: "noul", noul: 0.05 };
      }
      return new Response(JSON.stringify({ answers, usage: null, id: "gen-x" }), { status: 200 });
    }) as typeof fetch;
    const j = await judgePrefetch({ question: "q", notes: [] });
    expect(j?.census["formula-docs"]).toBe(0);
  });

  it("omits a note from `teach` when its Noul fails to parse, rather than defaulting to 0 — filterTeachingsByJev depends on the distinction", async () => {
    globalThis.fetch = (async (_url: any, init: any) => {
      lastBody = JSON.parse(init.body);
      const answers: Record<string, unknown> = { complexity: { type: "noul", noul: 0.1 } };
      for (const slug of CENSUS_SLUGS) answers[slug] = { type: "noul", noul: 0.05 };
      answers["teach:n1"] = { type: "choice", choice: "x" };
      return new Response(JSON.stringify({ answers, usage: null, id: "gen-x" }), { status: 200 });
    }) as typeof fetch;
    const j = await judgePrefetch({ question: "q", notes: [{ id: "n1", subject: null, content: "C" }] });
    expect("n1" in (j?.teach ?? {})).toBe(false);
  });
});

describe("judgePrefetch — off switch and failure modes", () => {
  it("returns null and makes no request when the model is the empty string", async () => {
    let called = false;
    globalThis.fetch = (async (_url: any, _init: any) => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    const j = await judgePrefetch({ question: "q", notes: [], model: "" });
    expect(j).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null and makes no request when config.chatPrefetchJudgeModel is empty and no override is given — askJev's own model fallback must never be reached", async () => {
    const saved = config.chatPrefetchJudgeModel;
    config.chatPrefetchJudgeModel = "";
    let called = false;
    globalThis.fetch = (async (_url: any, _init: any) => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    try {
      const j = await judgePrefetch({ question: "q", notes: [] });
      expect(j).toBeNull();
      expect(called).toBe(false);
    } finally {
      config.chatPrefetchJudgeModel = saved;
    }
  });

  it("returns null within its deadline on a hung request", async () => {
    hanging();
    const t0 = Date.now();
    const j = await judgePrefetch({ question: "q", notes: [], deadlineMs: 150 });
    const elapsed = Date.now() - t0;
    expect(j).toBeNull();
    expect(elapsed).toBeLessThan(1000); // un-deadlined retries would take ~3.5s+
  });

  it("returns null on a transport error, never throws", async () => {
    answering({}, 500);
    const j = await judgePrefetch({ question: "q", notes: [], deadlineMs: 200 });
    expect(j).toBeNull();
  });
});

describe("shipped thresholds", () => {
  it("sit where each constant's comment says they were measured", () => {
    expect(JEV_COMPLEXITY_THRESHOLD).toBe(0.58);
    expect(JEV_CENSUS_THRESHOLD).toBe(0.6);
    expect(JEV_TEACH_THRESHOLD).toBe(0.5);
  });
});

describe("filterTeachingsByJev", () => {
  const hit = (id: string): RankedTeaching => ({ id, subject: null, content: "c", score: 0, lex: 0, ternlight: null });

  it("keeps everything when there is no judgement — Jev off, late, or failed", () => {
    expect(filterTeachingsByJev([hit("n1"), hit("n2")], null)).toHaveLength(2);
  });

  it("drops a note scored below the threshold, keeps one at/above it", () => {
    const judgement: PrefetchJudgement = {
      complexity: null,
      census: emptyCensus(),
      teach: { n1: 0.49, n2: 0.5 },
      latencyMs: 1,
      costUsd: null,
      generationId: null,
    };
    const kept = filterTeachingsByJev([hit("n1"), hit("n2")], judgement);
    expect(kept.map((h) => h.id)).toEqual(["n2"]);
  });

  it("keeps a note the judgement never ruled on — fail OPEN, never fail closed", () => {
    const judgement: PrefetchJudgement = {
      complexity: null,
      census: emptyCensus(),
      teach: {},
      latencyMs: 1,
      costUsd: null,
      generationId: null,
    };
    expect(filterTeachingsByJev([hit("n1")], judgement)).toHaveLength(1);
  });
});

describe("prefetch-questions.ts drift guard", () => {
  it("has a Jev question for every census slug in CENSUS_SLUGS", () => {
    expect(everySlugHasAQuestion()).toBe(true);
  });
});
