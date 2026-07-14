// Pure tests for the verifier-eval tamper functions.
import { test, expect } from "bun:test";
import { loadIndexes } from "../../src/server/indexes.ts";
import { extractCitations, findInvalidCitationUuids } from "../../src/server/verify-checks.ts";
import { buildMutations, mutateNumber, mutateUnknownUuid, mutateWrongDoc } from "./eval-verifier-mutations.ts";

const ix = loadIndexes();
const realUuid = ix.docMap.keys().next().value as string;
const run = {
  id: "t1",
  question: "q",
  answer: `The rate is 12.5% per [Doc](/atlas/${realUuid}). See also \`code 99\`.`,
  evidence: [],
};

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
