// Run under `bun test` (NOT vitest). Mocks ../chat/llm.ts's getClient/getModel
// so proposePredecessor / proposeClusterAssignment never make a real network call.
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
// Snapshot the REAL llm exports into a plain object NOW, before any mock.module
// runs. bun's `import *` namespace is LIVE — it would reflect our own mock later,
// so spreading the namespace in afterAll would re-install the mock instead of
// restoring the real module. Spreading here (import time, no mock active yet)
// captures the real functions. The stub spreads this so callWithTimeout /
// openrouterJson-Stream stay real (only getClient/getModel are overridden), and
// afterAll restores it — bun's mock.module is process-global, so a partial or
// unrestored stub breaks every later file that imports from chat/llm.ts.
import * as realLlmNs from "../chat/llm.ts";
const realLlm = { ...realLlmNs };

// Shared mock completion response — overwritten per-test via `completionImpl`.
let completionImpl: (args: any) => Promise<{ choices: { message: { content: string } }[] }> = async () => ({
  choices: [{ message: { content: "{}" } }],
});

function mockLlm(content: string | ((args: any) => Promise<any>)) {
  completionImpl = typeof content === "function"
    ? content
    : async () => ({ choices: [{ message: { content } }] });
  mock.module("../chat/llm.ts", () => ({
    ...realLlm,
    getClient: () => ({
      chat: { completions: { create: (args: any) => completionImpl(args) } },
    }),
    getModel: () => "mock-model",
  }));
}

// Restore the real llm.ts so later test files inherit no partial stub.
afterAll(() => {
  mock.module("../chat/llm.ts", () => ({ ...realLlm }));
});

describe("proposePredecessor", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("returns the chosen candidate key and rationale on a strict JSON response", async () => {
    mockLlm(JSON.stringify({ chosenKey: "c1", why: "small coherent diff" }));
    const { proposePredecessor } = await import("./history-curate.ts");
    const result = await proposePredecessor(
      { title: "Newer Doc", content: "newer content" },
      [{ key: "c1", title: "Older Doc", content: "older content" }],
    );
    expect(result).toEqual({ chosenKey: "c1", why: "small coherent diff" });
  });

  it("falls back to 'none' when the model returns a key not in the candidate list", async () => {
    mockLlm(JSON.stringify({ chosenKey: "hallucinated", why: "made up" }));
    const { proposePredecessor } = await import("./history-curate.ts");
    const result = await proposePredecessor(
      { title: "Newer Doc", content: "newer content" },
      [{ key: "c1", title: "Older Doc", content: "older content" }],
    );
    expect(result.chosenKey).toBe("none");
  });

  it("recovers JSON wrapped in a prose preamble / code fence (loose parse)", async () => {
    mockLlm("I'll analyze this.\n```json\n{\"chosenKey\":\"c1\",\"why\":\"matches\"}\n```");
    const { proposePredecessor } = await import("./history-curate.ts");
    const result = await proposePredecessor(
      { title: "Newer", content: "x" },
      [{ key: "c1", title: "Older", content: "y" }],
    );
    expect(result).toEqual({ chosenKey: "c1", why: "matches" });
  });

  it("defaults to none/empty why when the response is unparseable garbage", async () => {
    mockLlm("not json at all, no braces");
    const { proposePredecessor } = await import("./history-curate.ts");
    const result = await proposePredecessor(
      { title: "Newer", content: "x" },
      [{ key: "c1", title: "Older", content: "y" }],
    );
    expect(result).toEqual({ chosenKey: "none", why: "" });
  });

  it("explicit 'none' from the model passes through even with candidates present", async () => {
    mockLlm(JSON.stringify({ chosenKey: "none", why: "genuinely new" }));
    const { proposePredecessor } = await import("./history-curate.ts");
    const result = await proposePredecessor(
      { title: "Newer", content: "x", context: { docNo: "A.1", prev: ["p1"], next: ["n1"], path: ["Root"], scope: "Governance", parent: "Owner" } },
      [{ key: "c1", title: "Older", content: "y", diff: "-old\n+new", context: { prev: [], next: [] }, soleHome: true }],
    );
    expect(result).toEqual({ chosenKey: "none", why: "genuinely new" });
  });

  it("includes alsoClaimedBy note and change context without throwing (option coverage)", async () => {
    let capturedUser = "";
    mockLlm(async (args: any) => {
      capturedUser = args.messages[1].content;
      return { choices: [{ message: { content: JSON.stringify({ chosenKey: "c1", why: "ok" }) } }] };
    });
    const { proposePredecessor } = await import("./history-curate.ts");
    await proposePredecessor(
      { title: "Newer", content: "x" },
      [{ key: "c1", title: "Older", content: "y", alsoClaimedBy: 2 }],
      { model: "custom-model", change: { pr: 99, title: "Update thing", summary: "did stuff" } },
    );
    expect(capturedUser).toContain("also a candidate for 2 other document(s)");
    expect(capturedUser).toContain("THE CHANGE that produced the newer document (PR #99)");
  });

  it("defaults why to empty string when the model omits it", async () => {
    mockLlm(JSON.stringify({ chosenKey: "c1" }));
    const { proposePredecessor } = await import("./history-curate.ts");
    const result = await proposePredecessor(
      { title: "Newer", content: "x" },
      [{ key: "c1", title: "Older", content: "y" }],
    );
    expect(result.why).toBe("");
  });
});

describe("proposeClusterAssignment", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("maps S/C ids back to real subject and candidate keys", async () => {
    mockLlm(JSON.stringify({
      assignments: [
        { subject: "S1", choice: "C1", why: "matches scope" },
        { subject: "S2", choice: "none", why: "new doc" },
      ],
    }));
    const { proposeClusterAssignment } = await import("./history-curate.ts");
    const result = await proposeClusterAssignment(
      [
        { key: "s1", title: "Newer 1", content: "a", order: 0 },
        { key: "s2", title: "Newer 2", content: "b", order: 1 },
      ],
      [{ key: "c1", title: "Older 1", content: "x" }],
    );
    expect(result.assignments).toEqual([
      { subjectKey: "s1", chosenKey: "c1", why: "matches scope" },
      { subjectKey: "s2", chosenKey: "none", why: "new doc" },
    ]);
    expect(result.conflicts).toBe(0);
    expect(result.missing).toBe(0);
  });

  it("counts a missing subject the model failed to return", async () => {
    mockLlm(JSON.stringify({ assignments: [{ subject: "S1", choice: "none", why: "" }] }));
    const { proposeClusterAssignment } = await import("./history-curate.ts");
    const result = await proposeClusterAssignment(
      [
        { key: "s1", title: "Newer 1", content: "a" },
        { key: "s2", title: "Newer 2", content: "b" },
      ],
      [{ key: "c1", title: "Older", content: "x" }],
    );
    expect(result.missing).toBe(1);
    expect(result.assignments.find((a) => a.subjectKey === "s2")).toEqual({
      subjectKey: "s2", chosenKey: "none", why: "(model omitted this subject)",
    });
  });

  it("counts a conflict when the model assigns the same candidate to two subjects, keeping the first", async () => {
    mockLlm(JSON.stringify({
      assignments: [
        { subject: "S1", choice: "C1", why: "first" },
        { subject: "S2", choice: "C1", why: "second" },
      ],
    }));
    const { proposeClusterAssignment } = await import("./history-curate.ts");
    const result = await proposeClusterAssignment(
      [
        { key: "s1", title: "Newer 1", content: "a" },
        { key: "s2", title: "Newer 2", content: "b" },
      ],
      [{ key: "c1", title: "Older", content: "x", soleHome: true }],
    );
    expect(result.conflicts).toBe(1);
    expect(result.assignments[0]).toEqual({ subjectKey: "s1", chosenKey: "c1", why: "first" });
    expect(result.assignments[1].chosenKey).toBe("none");
    expect(result.assignments[1].why).toContain("conflict: c1 already used");
  });

  it("treats a hallucinated candidate id as 'none'", async () => {
    mockLlm(JSON.stringify({ assignments: [{ subject: "S1", choice: "C99", why: "bogus" }] }));
    const { proposeClusterAssignment } = await import("./history-curate.ts");
    const result = await proposeClusterAssignment(
      [{ key: "s1", title: "Newer", content: "a" }],
      [{ key: "c1", title: "Older", content: "x" }],
    );
    expect(result.assignments[0]).toEqual({ subjectKey: "s1", chosenKey: "none", why: "bogus" });
  });

  it("respects a custom clip length and occurrence-suffix key without throwing", async () => {
    let capturedUser = "";
    mockLlm(async (args: any) => {
      capturedUser = args.messages[1].content;
      return { choices: [{ message: { content: JSON.stringify({ assignments: [] }) } }] };
    });
    const { proposeClusterAssignment } = await import("./history-curate.ts");
    const result = await proposeClusterAssignment(
      [{ key: "s1", title: "Newer", content: "a".repeat(2000), order: 3 }],
      [{ key: "c1#2", title: "Older", content: "y", soleHome: true }],
      { clip: 50, change: { pr: 5, title: "Bump", summary: "notes" } },
    );
    expect(capturedUser).toContain("(order 2)");
    expect(capturedUser).toContain("THE CHANGE that produced these documents (PR #5)");
    expect(result.missing).toBe(1); // S1 not present in the mocked (empty) response
  });
});
