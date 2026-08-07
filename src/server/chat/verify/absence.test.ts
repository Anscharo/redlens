// Absence-claim contract tests: each of the three outcomes, precedence
// (refuted > grounded > unverified), and owner disambiguation. Uses a small
// synthetic fixture (buildIndexes) mirroring verify-checks.test.ts's pattern
// so this file stays self-contained and doesn't drift with atlas content.
import { test, expect } from "bun:test";
import { buildIndexes } from "../../retrieval/indexes.ts";
import type { AtlasNode } from "../../../types.ts";
import { auditAbsenceClaim } from "./absence.ts";

function node(p: Partial<AtlasNode> & { id: string; doc_no: string; title: string; content: string }): AtlasNode {
  return { type: "Core", depth: 3, parentId: null, order: 0, addressRefs: [], ...p };
}

const keelOwner = node({ id: "keel-owner", doc_no: "T.1", title: "Keel", type: "Instance", depth: 2, content: "" });
const keelParam = node({
  id: "keel-param",
  doc_no: "T.1.1",
  title: "USDS Mint Maximum",
  parentId: "keel-owner",
  content: [
    "The maximum amount of USDS that can be minted is specified in the document herein.",
    "",
    "- `maxAmount`: 10,000 USDS",
    "- `slope`: 10,000 USDS per day",
  ].join("\n"),
});
// Only Keel has a hook rate — used to test owner disambiguation (a Spark
// claim must NOT be refuted by Keel's row).
const keelHook = node({
  id: "keel-hook",
  doc_no: "T.1.2",
  title: "Hook Rate Parameters",
  parentId: "keel-owner",
  content: ["Hook rate parameters are specified in the document herein.", "", "- `Hook Rate`: 3%"].join("\n"),
});
const sparkOwner = node({ id: "spark-owner", doc_no: "T.2", title: "Spark", type: "Instance", depth: 2, content: "" });
const ix = buildIndexes([keelOwner, keelParam, keelHook, sparkOwner], [], [], {});

test("refuted: a claimed absence has a known parameter-table value", () => {
  const audit = auditAbsenceClaim("the atlas does not specify a USDS mint maximum for Keel", [], ix);
  expect(audit.outcome).toBe("refuted");
  expect(audit.detail).toBe("maxamount (keel) = 10,000 USDS (T.1.1)");
});

test("owner disambiguation: Keel's row does not refute a Spark absence claim", () => {
  const audit = auditAbsenceClaim("the atlas does not specify a hook rate for Spark", [], ix);
  expect(audit.outcome).not.toBe("refuted");
});

test("owner disambiguation: the same term correctly refutes when the claim names the right owner", () => {
  const audit = auditAbsenceClaim("the atlas does not specify a hook rate for Keel", [], ix);
  expect(audit.outcome).toBe("refuted");
  expect(audit.detail).toContain("hook rate (keel)");
});

test("grounded: a scaffold-tagged doc in the turn's evidence honestly explains the gap", () => {
  const evidence = ['{"id":"x","liveness":"scaffold","title":"Lawyer Registry"}'];
  const audit = auditAbsenceClaim("the atlas does not specify a lawyer registry entry for Grove", evidence, ix);
  expect(audit.outcome).toBe("grounded");
  expect(audit.detail).toBe("grounded: liveness:scaffold");
});

test("grounded: a placeholder-tagged doc also counts", () => {
  const evidence = ['{"id":"x","liveness":"placeholder"}'];
  const audit = auditAbsenceClaim("the atlas does not specify a governance token vesting cliff", evidence, ix);
  expect(audit.outcome).toBe("grounded");
  expect(audit.detail).toBe("grounded: liveness:placeholder");
});

test("grounded: an empty search result (count:0) counts", () => {
  const evidence = ['{"count":0,"results":[],"mode":"lexical"}'];
  const audit = auditAbsenceClaim("the atlas does not specify a governance token vesting cliff", evidence, ix);
  expect(audit.outcome).toBe("grounded");
  expect(audit.detail).toBe("grounded: empty-result");
});

test("grounded: an empty search result (results:[] with no count field) counts", () => {
  const evidence = ['{"results":[],"mode":"semantic"}'];
  const audit = auditAbsenceClaim("the atlas does not specify a governance token vesting cliff", evidence, ix);
  expect(audit.outcome).toBe("grounded");
});

test("NOT grounded: a real, populated search envelope (round-checks' isEmptyResult trap) must not pass", () => {
  // The exact envelope shape round-checks.ts's isEmptyResult was fixed to
  // reject (a populated `mode` string, no count:0/results:[] signature).
  const evidence = ['{"count":3,"mode":"hybrid","results":[{"id":"a"},{"id":"b"},{"id":"c"}]}'];
  const audit = auditAbsenceClaim("the atlas does not specify a governance token vesting cliff", evidence, ix);
  expect(audit.outcome).toBe("unverified");
});

test("unverified: no refutation and no grounding signal", () => {
  const audit = auditAbsenceClaim("the atlas does not specify a governance token vesting cliff", [], ix);
  expect(audit).toEqual({
    outcome: "unverified",
    detail: "could not verify the claimed absence — no empty-result or scaffold evidence, and no parameter-table refutation",
  });
});

test("precedence: refuted beats grounded when both signals are present", () => {
  const evidence = ['{"count":0,"results":[]}'];
  const audit = auditAbsenceClaim("the atlas does not specify a USDS mint maximum for Keel", evidence, ix);
  expect(audit.outcome).toBe("refuted");
});
