// The corpus detectors exist because the document sweep structurally cannot see
// a defect that lives between documents. What is pinned here is the line
// between template DRIFT (a defect) and artifacts legitimately differing.

import { describe, it, expect } from "vitest";
import {
  normalizeForCompare,
  slotKey,
  templateDivergence,
  uniqueWords,
  wordDistance,
} from "../scripts/lib/mistakes-corpus.mjs";

type N = { id: string; doc_no: string; title: string; type: string; content: string };
const node = (doc_no: string, title: string, content: string): N => ({
  id: doc_no, doc_no, title, type: "Core", content,
});

/** Eight artifacts, one shared sentence, with `odd` said differently by some. */
const artifacts = (sentence: (agent: string) => string, odd: Record<number, string> = {}) => {
  const names = ["Spark", "Grove", "Keel", "Skybase", "Obex", "Pattern", "Osero", "Launch Agent 7"];
  const out: N[] = names.map((n, i) => node(`A.6.1.1.${i + 1}`, n, ""));
  names.forEach((n, i) => {
    out.push(node(`A.6.1.1.${i + 1}.2.9.1`, "Submission", odd[i + 1] ?? sentence(n)));
  });
  return out;
};

const SENT = (word: string) => (agent: string) =>
  `A ${agent} token holder must hold at least 1% of the ${word} token supply to submit a proposal.`;

describe("slotKey", () => {
  it("maps the same position in different artifacts to one slot", () => {
    expect(slotKey("A.6.1.1.3.2.2.1")?.slot).toBe("A.6.1.1.*.2.2.1");
    expect(slotKey("A.6.1.1.7.2.2.1")?.slot).toBe("A.6.1.1.*.2.2.1");
  });

  it("ignores documents outside the Prime Agent artifacts", () => {
    expect(slotKey("A.1.2.3")).toBeNull();
  });
});

describe("normalizeForCompare", () => {
  // Each artifact says its own name and token. Without masking, every sentence
  // differs and nothing is comparable.
  it("masks the artifact's own name and token symbol", () => {
    expect(normalizeForCompare("A KEEL holder of Keel", "Keel")).toBe(
      normalizeForCompare("A SPK holder of Spark", "Spark"),
    );
  });

  it("ignores smart quotes, markdown emphasis and a/an agreement", () => {
    expect(normalizeForCompare("An **Obex**’s `x`", "Obex")).toBe(
      normalizeForCompare("A <agent>'s x", "Nothing"),
    );
  });
});

describe("wordDistance / uniqueWords", () => {
  it("counts only the words that actually changed", () => {
    expect(wordDistance("a b c d", "a b c d")).toBe(0);
    expect(wordDistance("a b c d", "a b x d")).toBe(2);
  });

  it("names the words one side has and the other does not", () => {
    expect(uniqueWords("hold the total supply", "hold the circulating supply")).toEqual(["total"]);
  });
});

describe("templateDivergence", () => {
  it("finds one word changed in a sentence the artifacts otherwise share", () => {
    const nodes = artifacts(SENT("total"), {
      3: SENT("circulating")("Keel"), 4: SENT("circulating")("Skybase"),
      5: SENT("circulating")("Obex"), 6: SENT("circulating")("Pattern"),
    });
    const [f, ...rest] = templateDivergence(nodes as never);
    expect(rest).toHaveLength(0);
    expect(f.docNo).toBe("A.6.1.1.*.2.9.1");
    expect(f.issue).toContain("circulating");
    expect(f.issue).toContain("total");
    expect(f.uuid).toBeNull();
    // The row must be re-derivable, which is what lets --full retire and rebuild it.
    expect(f.detector).toBe("template-divergence");
  });

  it("says nothing when every artifact agrees", () => {
    expect(templateDivergence(artifacts(SENT("total")) as never)).toHaveLength(0);
  });

  // Each Prime names its own executor agent and its own multisig. That is the
  // artifacts differing, not the template drifting, and it is most of what a
  // naive comparison would report.
  it("ignores a difference too large to be one drifting word", () => {
    const nodes = artifacts(SENT("total"), {
      1: "A holder must instead follow an entirely separate and much longer route that shares nothing.",
    });
    expect(templateDivergence(nodes as never)).toHaveLength(0);
  });

  it("ignores a slot too few artifacts share", () => {
    const nodes = artifacts(SENT("total")).filter(
      (n) => !/^A\.6\.1\.1\.[4-8]\.2\.9\.1$/.test(n.doc_no),
    );
    nodes.push(node("A.6.1.1.1.2.9.1", "Submission", SENT("circulating")("Spark")));
    expect(templateDivergence(nodes as never)).toHaveLength(0);
  });

  // The divergence that matters most is a link pointing somewhere else while
  // reading identically. An earlier version masked every doc_no and UUID to a
  // placeholder, so those compared equal and this case produced NOTHING.
  it("sees a link whose target differs though its text does not", () => {
    const names = ["Spark", "Grove", "Keel", "Skybase", "Obex"];
    const uuid = (a: number, n: number) => `${String(a).repeat(8)}-0000-4000-8000-${String(n).repeat(12)}`;
    const nodes: N[] = [];
    names.forEach((nm, i) => {
      const a = i + 1;
      nodes.push(node(`A.6.1.1.${a}`, nm, ""));
      nodes.push({ ...node(`A.6.1.1.${a}.9.2`, "Active Instances", ""), id: uuid(a, 2) });
      nodes.push({ ...node(`A.6.1.1.${a}.9.3`, "Active Instances", ""), id: uuid(a, 3) });
      // Keel links to .9.3; everyone else to .9.2. The visible text is identical.
      nodes.push(node(
        `A.6.1.1.${a}.9.1`, "In Progress",
        `Invocations that complete successfully are always moved to [Active Instances](${uuid(a, a === 3 ? 3 : 2)}) for the record.`,
      ));
    });
    const [f, ...rest] = templateDivergence(nodes as never);
    expect(rest).toHaveLength(0);
    // The quoted fragments come from normalized text, which is lowercased.
    expect(f.issue).toContain("a.6.1.1.*.9.3"); // the target Keel actually links to
    expect(f.issue).toContain("a.6.1.1.*.9.2"); // the one everyone else links to
    expect(f.issue).toContain("Keel");
  });

  // An N-way split is N-1 rows naming who departs from the norm, not one row
  // per pair saying everyone differs from everyone.
  it("measures each variant against the majority reading", () => {
    const nodes = artifacts(SENT("total"), {
      3: SENT("circulating")("Keel"), 4: SENT("circulating")("Skybase"),
      5: SENT("circulating")("Obex"), 6: SENT("circulating")("Pattern"),
      7: SENT("outstanding")("Osero"),
    });
    const out = templateDivergence(nodes as never);
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.issue.includes("circulating"))).toBe(true);
  });

  // Regression: comparing each variant against the SLOT's majority rather than
  // its sentence family silently lost this. A document holds several sentences,
  // so the divergent pair are usually BOTH minorities within the slot -- here
  // the shared preamble outnumbers either reading of the sentence that differs.
  it("finds a divergence whose both readings are slot minorities", () => {
    const withPreamble = (word: string) => (agent: string) =>
      `The Root Edit process begins with a ${agent} token holder submitting a full proposal for review. ` +
      `A ${agent} token holder must hold at least 1% of the ${word} token supply to submit a proposal.`;
    const nodes = artifacts(withPreamble("total"), {
      3: withPreamble("circulating")("Keel"), 4: withPreamble("circulating")("Skybase"),
      5: withPreamble("circulating")("Obex"), 6: withPreamble("circulating")("Pattern"),
    });
    const out = templateDivergence(nodes as never);
    expect(out).toHaveLength(1);
    expect(out[0].issue).toContain("circulating");
    expect(out[0].issue).toContain("total");
  });

  it("gives two divergent sentences in one slot distinct ids", () => {
    const two = (a: string, b: string) => (agent: string) =>
      `A ${agent} token holder must hold at least 1% of the ${a} token supply to submit a proposal. ` +
      `The ${agent} proposal must also be posted to the ${b} forum category without any delay whatsoever.`;
    const nodes = artifacts(two("total", "main"), {
      3: two("circulating", "other")("Keel"), 4: two("circulating", "other")("Skybase"),
      5: two("circulating", "other")("Obex"), 6: two("circulating", "other")("Pattern"),
    });
    const ids = templateDivergence(nodes as never).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
