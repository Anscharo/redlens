// Absence-claim contract tests: refuteAbsenceSentences synthesizes a
// Contradiction candidate directly from a parameter-table refutation — the
// owner token is the precision bar (these are raw sentences, never isolated
// as claims by a judge). Uses a small synthetic fixture (buildIndexes)
// mirroring verify-checks.test.ts's pattern so this file stays self-contained
// and doesn't drift with atlas content.
import { test, expect } from "bun:test";
import { buildIndexes } from "../../retrieval/indexes.ts";
import type { AtlasNode } from "../../../types.ts";
import { refuteAbsenceSentences } from "./absence.ts";

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
const keelHook = node({
  id: "keel-hook",
  doc_no: "T.1.2",
  title: "Hook Rate Parameters",
  parentId: "keel-owner",
  content: ["Hook rate parameters are specified in the document herein.", "", "- `Hook Rate`: 3%"].join("\n"),
});
const sparkOwner = node({ id: "spark-owner", doc_no: "T.2", title: "Spark", type: "Instance", depth: 2, content: "" });
const ix = buildIndexes([keelOwner, keelParam, keelHook, sparkOwner], [], [], {});

test("owner present: refutes an absence sentence with a known parameter-table value", () => {
  const out = refuteAbsenceSentences("The atlas does not specify a USDS mint maximum for Keel.", ix);
  expect(out).toHaveLength(1);
  expect(out[0].source).toBe("param-table");
  expect(out[0].agreed).toBe(false);
  expect(out[0].evidence_label).toBe("[E-const]");
  expect(out[0].evidence_span).toBe("maxamount (keel) = 10,000 USDS (T.1.1)");
  expect(out[0].uuid).toBe("keel-param");
});

test("owner absent: the same term without naming the owner produces nothing — the precision bar", () => {
  // The parameter table has exactly one "hook rate", owned by Keel, but this
  // sentence never names Keel — the owner-token check must reject it, not
  // fall back to the only candidate.
  const out = refuteAbsenceSentences("The atlas does not specify a hook rate for this primitive.", ix);
  expect(out).toHaveLength(0);
});

test("owner present but wrong entity: Keel's row must not refute a Spark absence claim", () => {
  const out = refuteAbsenceSentences("The atlas does not specify a hook rate for Spark.", ix);
  expect(out).toHaveLength(0);
});

test("no matching parameter row at all: nothing to refute", () => {
  const out = refuteAbsenceSentences("The atlas does not specify a governance token vesting cliff for Keel.", ix);
  expect(out).toHaveLength(0);
});

test("a sentence that is not an absence claim at all is never scanned for refutation", () => {
  const out = refuteAbsenceSentences("Keel's USDS mint maximum is 10,000 USDS.", ix);
  expect(out).toHaveLength(0);
});

test("multiple absence sentences in one answer each get their own candidate", () => {
  const answer = [
    "The atlas does not specify a USDS mint maximum for Keel.",
    "The atlas does not specify a hook rate for Keel.",
  ].join(" ");
  const out = refuteAbsenceSentences(answer, ix);
  expect(out.map((c) => c.answer_span)).toEqual([
    "The atlas does not specify a USDS mint maximum for Keel.",
    "The atlas does not specify a hook rate for Keel.",
  ]);
});
