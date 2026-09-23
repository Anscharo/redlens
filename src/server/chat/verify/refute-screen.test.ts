// refute-screen.ts: statement splitting, evidence narrowing (cited docs read
// from the index, top-8 tool records, [E0] excluded), the token budget, the
// answer reader, and the deadline failing open to null.
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { config } from "../../config.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { JevRun } from "../../jev.ts";
import type { EvidenceEntry } from "./verifier.ts";
import {
  buildScreenRequest, needsGemma, readScreen, screenParagraph, statementsOf,
  SCREEN_CONTRADICTED_THRESHOLD, SCREEN_TOKENS_PER_QUESTION, UNIT_CRITERIA,
  type ScreenResult,
} from "./refute-screen.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const node = (id: string, doc_no: string, title: string, content: string) =>
  ({ id, doc_no, title, content, type: "Core", parentId: null, depth: 1, order: 0, addressRefs: [] }) as any;
const docA = node(A, "A.1.2", "Signer Threshold", "The Operational Multisig requires 3 of 5 signers. Full text beyond any excerpt.");
const docB = node(B, "A.1.3", "Rate Limits", "Rate limits apply to the Spark instance.");
const ix = { docMap: new Map([[A, docA], [B, docB]]), byDocNo: new Map([["A.1.2", docA], ["A.1.3", docB]]), childrenIndex: new Map() } as unknown as Indexes;
const ev = (label: string, tool: string, content: unknown): EvidenceEntry => ({ label, tool, args: "", content: typeof content === "string" ? content : JSON.stringify(content) });

const realFetch = globalThis.fetch;
const realKey = config.openrouterApiKey;
beforeEach(() => {
  config.openrouterApiKey = "test-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.openrouterApiKey = realKey;
});

describe("statementsOf", () => {
  it("keeps link text, drops URLs and markup, and drops fragments under three real words", () => {
    const s = statementsOf(`- **Spark** holds the [Operational Multisig](/atlas/${A}) with 3 signers.\n### Heading here\nOk then.`);
    expect(s).toEqual(["Spark holds the Operational Multisig with 3 signers."]);
  });
  it("rewrites table rows into labelled prose before splitting", () => {
    const s = statementsOf("| Multisig | Signers |\n|---|---|\n| Operational Multisig wallet | 3 of 5 |");
    expect(s.length).toBe(1);
    expect(s[0]).toContain("Operational Multisig wallet");
    expect(s[0]).toContain("3 of 5");
  });
});

describe("buildScreenRequest", () => {
  it("reads cited docs in full from the index (by link and by doc_no), and never sends the [E0] schema", () => {
    const req = buildScreenRequest({
      question: "q",
      paragraph: `The Operational Multisig needs 7 of 9 signers ([Signer Threshold](/atlas/${A})). Rate limits live in A.1.3 for the Spark instance.`,
      evidence: [ev("[E0]", "atlas_schema", { docs: 11340 }), ev("[E1]", "atlas_search", { results: [{ id: A, snippet: "requires 3 of" }] })],
      ix,
    });
    const sources = req.state.evidence.map((e) => e.source);
    expect(sources.slice(0, 2)).toEqual(["atlas document A.1.2 (cited by the paragraph)", "atlas document A.1.3 (cited by the paragraph)"]);
    expect((req.state.evidence[0].record as { content: string }).content).toContain("Full text beyond any excerpt");
    expect(sources.some((s) => s.startsWith("[E0]"))).toBe(false);
    expect(sources.some((s) => s.startsWith("[E1]"))).toBe(true); // tool records that mention the cited doc are added too
    expect(req.counts.citedDocs).toBe(2);
    expect(req.fits).toBe(true);
  });

  it("an uncited paragraph gets at most 8 tool records, by overlap, zero-overlap ones never", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, text: i < 10 ? `Spark multisig signer ${i}` : "unrelated weather" }));
    const req = buildScreenRequest({ question: "q", paragraph: "The Spark multisig has several signer seats.", evidence: [ev("[E1]", "atlas_query", rows)], ix });
    expect(req.counts.toolRecords).toBe(8);
    expect(JSON.stringify(req.state.evidence)).not.toContain("weather");
  });

  it("always carries the [E-const] param rows", () => {
    const req = buildScreenRequest({
      question: "q", paragraph: "Nothing in common with anything here at all.",
      evidence: [ev("[E-const]", "atlas_param_table", [{ name: "threshold", value: 3 }])], ix,
    });
    expect(req.state.evidence.map((e) => e.source)).toEqual(["[E-const] atlas_param_table [0]"]);
  });

  it("one Choice per statement, keyed u0.., with the measured criteria verbatim", () => {
    const req = buildScreenRequest({ question: "q", paragraph: "Spark holds three signer seats. Grove holds two signer seats.", evidence: [], ix });
    expect(Object.keys(req.questions)).toEqual(["u0", "u1"]);
    expect(req.questions.u1.criteria).toBe(UNIT_CRITERIA);
    expect(req.questions.u1.instructions).toContain('"Grove holds two signer seats."');
  });

  it("budget: 23 statements cost ~7k tokens up front; cited docs that overflow the rest make it unfit", () => {
    const paragraph = Array.from({ length: 23 }, (_, i) => `Statement number ${i} says something here.`).join(" ");
    const big = node(A, "A.1.2", "Big", "x".repeat(50_000));
    const bigIx = { ...ix, docMap: new Map([[A, big]]), byDocNo: new Map([["A.1.2", big]]) } as unknown as Indexes;
    const small = buildScreenRequest({ question: "q", paragraph, evidence: [], ix });
    expect(small.statements.length).toBe(23);
    expect(small.estTokens).toBeGreaterThanOrEqual(23 * SCREEN_TOKENS_PER_QUESTION);
    expect(small.fits).toBe(true);
    const over = buildScreenRequest({ question: "q", paragraph: `${paragraph} See A.1.2.`, evidence: [], ix: bigIx });
    expect(over.fits).toBe(false);
  });

  it("tool records that would overflow are dropped from the tail, and the request still fits", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, text: `Spark signer ${"y".repeat(9000)} ${i}` }));
    const req = buildScreenRequest({ question: "q", paragraph: "The Spark signer set is small.", evidence: [ev("[E1]", "atlas_query", rows)], ix });
    expect(req.fits).toBe(true);
    expect(req.counts.droppedForBudget).toBeGreaterThan(0);
    expect(req.estTokens).toBeLessThanOrEqual(28_000);
  });
});

const choice = (c: string, pc: number) => ({ type: "choice", choice: c, probabilities: { consistent: 1 - pc, contradicted: pc, unsupported: 0 }, confidence: 0.9 });
const runOf = (answers: Record<string, unknown>): JevRun => ({ answers: answers as JevRun["answers"], usage: null, cost: 0.0002, generationId: "gen-1", latencyMs: 400 });

describe("readScreen / needsGemma", () => {
  const req = buildScreenRequest({ question: "q", paragraph: "Spark holds three signer seats. Grove holds two signer seats.", evidence: [], ix });
  it(`flags at max P(contradicted) ≥ ${SCREEN_CONTRADICTED_THRESHOLD}`, () => {
    const low = readScreen(req, runOf({ u0: choice("consistent", 0.1), u1: choice("consistent", 0.19) }))!;
    expect(low.flagged).toBe(false);
    expect(needsGemma(low, "Some paragraph with real prose in it.")).toBe(false);
    const high = readScreen(req, runOf({ u0: choice("consistent", 0.1), u1: choice("consistent", 0.2) }))!;
    expect(high).toMatchObject({ flagged: true, maxContradicted: 0.2, fits: true, latencyMs: 400 });
    expect(needsGemma(high, "Some paragraph with real prose in it.")).toBe(true);
  });
  it("an unanswered or foreign-verdict statement means the screen cannot vouch: null", () => {
    expect(readScreen(req, runOf({ u0: choice("consistent", 0) }))).toBeNull();
    expect(readScreen(req, runOf({ u0: choice("consistent", 0), u1: choice("toString", 0) }))).toBeNull();
    expect(needsGemma(null, "Some paragraph with real prose in it.")).toBe(true);
  });
});

describe("screenParagraph", () => {
  it("fails open to null at its own deadline when Jev hangs", async () => {
    globalThis.fetch = ((_u: unknown, init: { signal: AbortSignal }) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await screenParagraph({ question: "q", paragraph: "Spark holds three signer seats.", evidence: [], ix, model: "m", deadlineMs: 50 });
    expect(r).toBeNull();
    expect(Date.now() - t0).toBeLessThan(300);
  });
  it("sends nothing for a paragraph with no statement, and reports it unflagged but unjudged", async () => {
    let calls = 0;
    globalThis.fetch = (async () => (calls++, new Response("{}"))) as unknown as typeof fetch;
    const r = await screenParagraph({ question: "q", paragraph: "### Summary", evidence: [], ix, model: "m" });
    expect(calls).toBe(0);
    expect(r).toMatchObject({ flagged: false, statements: [], fits: true });
    expect(needsGemma(r, "Some paragraph with real prose in it.")).toBe(true);
  });
  it("parses a real-shaped response", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "gen-dec-1", answers: { u0: choice("contradicted", 0.91) }, usage: { input_tokens: 900, output_tokens: 1, cost: 0.0002 } }))) as unknown as typeof fetch;
    const r = await screenParagraph({ question: "q", paragraph: "Spark holds three signer seats.", evidence: [], ix, model: "m" });
    expect(r).toMatchObject({ flagged: true, maxContradicted: 0.91, inputTokens: 900, costUsd: 0.0002, generationId: "gen-dec-1" });
    expect(r!.statements[0]).toEqual({ text: "Spark holds three signer seats.", verdict: "contradicted", p: 0.91 });
  });
});

// Gate mode used to send every statement-less paragraph to gemma: 9 of the 16
// it still called were headings or rules, and gemma found nothing in any.
describe("needsGemma on statement-less paragraphs", () => {
  const clean = (statements: ScreenResult["statements"] = []): ScreenResult => ({
    flagged: false, maxContradicted: 0, statements, fits: true, latencyMs: 1,
    estTokens: 10, inputTokens: null, costUsd: null, generationId: null,
  });

  it("skips a heading or a horizontal rule", () => {
    expect(needsGemma(clean(), "## Key changes")).toBe(false);
    expect(needsGemma(clean(), "---")).toBe(false);
    expect(needsGemma(clean(), "### Threshold requirements")).toBe(false);
  });

  it("still sends a terse claim carrying a figure — the shape a number swap hides in", () => {
    expect(needsGemma(clean(), "Threshold: 3 of 5")).toBe(true);
    expect(needsGemma(clean(), "Signers: 7")).toBe(true);
  });

  it("still sends anything with a link, uuid or doc number", () => {
    expect(needsGemma(clean(), "See [Rate Limits](/atlas/abc)")).toBe(true);
    expect(needsGemma(clean(), "Per A.2.7.1.1.")).toBe(true);
  });

  it("still sends a paragraph that has prose but produced no statements", () => {
    expect(needsGemma(clean(), "Because of that and the rest of it")).toBe(true);
  });
});
