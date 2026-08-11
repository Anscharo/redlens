// Pure tests for the verifier-eval tamper functions.
//
// FIXTURES ARE BUILT IN beforeAll, NOT AT MODULE SCOPE. This used to call
// `loadIndexes()` at module scope, which is wrong twice over: (1) loadIndexes()
// is a process-global memo, so under a combined `bun test src/server
// scripts/aux/...` run it hands back whatever the last `setIndexes()` in an
// earlier file installed — a one-node fixture set, say — rather than the real
// atlas; and (2) if the public/ artifacts are missing it silently yields an
// empty docMap, `realUuid` becomes `undefined`, and the failures show up as
// unrelated assertion noise about mutated strings.
//
// Reading the artifacts directly and calling buildIndexes ourselves gives a
// private index set with no dependence on file order — and, unlike
// rebuildFromDisk(), no side effect on the shared singleton either.
import { test, expect, beforeAll } from "bun:test";
import { buildIndexes, readArtifactsFromDisk, type Indexes } from "../../src/server/retrieval/indexes.ts";
import { extractCitations, findInvalidCitationUuids } from "../../src/server/chat/verify/verify-checks.ts";
import type { SavedRun } from "./eval-verifier-mutations.ts";
import { buildMutations, mutateNumber, mutateUnknownUuid, mutateWrongDoc } from "./eval-verifier-mutations.ts";

let ix: Indexes;
let realUuid: string;
let run: SavedRun;

beforeAll(() => {
  const art = readArtifactsFromDisk();
  ix = buildIndexes(art.docs, art.entities, art.edges, art.meta, art.searchIndexJson, art.glossaryTerms);
  expect(
    ix.docMap.size,
    "no atlas docs on disk — run the artifact build (pnpm build:index && pnpm build:graph) before this test",
  ).toBeGreaterThan(0);
  realUuid = ix.docMap.keys().next().value as string;
  run = {
    id: "t1",
    question: "q",
    answer: `The rate is 12.5% per [Doc](/atlas/${realUuid}). See also \`code 99\`.`,
    evidence: [],
  };
});

test("mutateUnknownUuid produces a citation the deterministic check must fail", () => {
  const mutated = mutateUnknownUuid(run.answer)!;
  const invalid = findInvalidCitationUuids(extractCitations(mutated), ix);
  expect(invalid).toHaveLength(1);
  // No citation → no mutation to make.
  expect(mutateUnknownUuid("no links here")).toBeNull();
});

test("mutateWrongDoc swaps to a real-but-different doc (passes the code check)", () => {
  const mutated = mutateWrongDoc(run.answer, ix)!;
  const cites = extractCitations(mutated);
  expect(cites[0].uuid).not.toBe(realUuid);
  expect(findInvalidCitationUuids(cites, ix)).toHaveLength(0);
});

test("mutateNumber corrupts prose numbers, never hrefs or inline code", () => {
  const mutated = mutateNumber(run.answer)!;
  expect(mutated).toContain("26"); // 12.5 → 12.5*2+1 = 26
  expect(mutated).toContain(`/atlas/${realUuid}`); // href untouched
  expect(mutated).toContain("`code 99`"); // inline code untouched
  expect(mutateNumber("no numbers")).toBeNull();
});

test("buildMutations always includes fabrication + ruling, others when applicable", () => {
  const classes = buildMutations(run, ix).map((m) => m.class);
  expect(classes).toEqual(["unknown_uuid", "wrong_doc", "number", "fabrication", "ruling"]);
  const bare = buildMutations({ ...run, answer: "plain answer" }, ix).map((m) => m.class);
  expect(bare).toEqual(["fabrication", "ruling"]);
});
