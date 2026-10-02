import { describe, expect, it } from "bun:test";
import { citationPairs, isLeadIn, tablesAsProse } from "./cite-pairs.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const TABLE = [
  "| Sender | Recipient | Amount | Source |",
  "| :--- | :--- | :--- | :--- |",
  `| **Sky Core** | Fortification Foundation | 10M USDS | [August 2025 Grant](/atlas/${A}) |`,
  `| Spark | SPK Company Ltd | 6.5B SPK | [Genesis](/atlas/${B}) |`,
].join("\n");

describe("tablesAsProse", () => {
  it("rewrites each data row as labelled prose — the header is what gives a cell its meaning", () => {
    const lines = tablesAsProse(TABLE).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith("Sender: Sky Core; Recipient: Fortification Foundation; Amount: 10M USDS.");
  });

  it("moves link-only cells behind the period so the trailing-citation fold attaches them", () => {
    expect(tablesAsProse(TABLE).split("\n")[0]).toEndWith(`10M USDS. [August 2025 Grant](/atlas/${A})`);
  });

  it("leaves non-table text, and a pipe line with no separator under it, untouched", () => {
    const text = "Plain prose.\n| not | a table |\nMore prose.";
    expect(tablesAsProse(text)).toBe(text);
  });
});

describe("citationPairs", () => {
  it("pairs each table row with its own source, as a labelled claim", () => {
    const pairs = citationPairs(TABLE);
    expect(pairs.map((p) => p.uuid)).toEqual([A, B]);
    expect(pairs[0].claim).toBe("Sender: Sky Core; Recipient: Fortification Foundation; Amount: 10M USDS.");
  });

  it("drops a bare label bullet — `* **Spark**:` with a link is not a claim", () => {
    expect(citationPairs(`* **Spark**: [Spark](/atlas/${A})`)).toEqual([]);
    expect(citationPairs(`* **Aave** [Aave](/atlas/${A})`)).toEqual([]);
  });

  it("keeps a short bullet that does make a claim", () => {
    const pairs = citationPairs(`* Managing reward payments for distributions [R](/atlas/${A}).`);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].claim).toBe("Managing reward payments for distributions.");
  });

  it("cleans the debris a removed link leaves — empty parens and orphaned commas", () => {
    const [p] = citationPairs(`Documents regarding \`Instance CRRs\` ([CRRs](/atlas/${A})) changed often.`);
    expect(p.claim).toBe("Documents regarding Instance CRRs changed often.");
  });
});

describe("multi-citation sentences", () => {
  // A sentence that cites twice used to hand BOTH documents the whole
  // sentence, so each was asked to justify an assertion it was never cited
  // for. Observed 2026-09-24: doc A (agent creation) was marked "not stated in
  // this source" for a sentence whose OTHER half was about Executor Accords.
  it("gives each citation the clause it is attached to, plus the sentence as context", () => {
    const pairs = citationPairs(
      `* They validate inputs for the creation of new agents [A](/atlas/${A}) and the setup of "Executor Accords" [B](/atlas/${B}).`,
    );
    expect(pairs).toHaveLength(2);
    expect(pairs[0].claim).toBe("They validate inputs for the creation of new agents");
    expect(pairs[1].claim).toBe('and the setup of "Executor Accords".');
    // The second clause has no subject of its own — without the sentence it is
    // unjudgeable, so context is required, not decorative.
    expect(pairs[0].context).toContain("Executor Accords");
    expect(pairs[1].context).toBe(pairs[0].context);
  });

  // The load-bearing property: this change must be inert for the ~86% of pairs
  // it has nothing to do with, in production AND in the eval's disk cache.
  it("leaves a single-citation sentence byte-identical, with no context", () => {
    const [p] = citationPairs(`The threshold is seven signers [T](/atlas/${A}).`);
    expect(p.claim).toBe("The threshold is seven signers.");
    expect(p.context).toBeUndefined();
  });

  // The tail after the LAST citation belongs to its clause — a trailing period
  // or closing paren is part of the sentence it ends.
  it("gives the last citation the tail after it", () => {
    const [p] = citationPairs(`Documents regarding \`Instance CRRs\` ([CRRs](/atlas/${A})) changed often.`);
    expect(p.claim).toBe("Documents regarding Instance CRRs changed often.");
    expect(p.context).toBeUndefined();
  });

  // A link at the very START has no clause before it; falling back to the whole
  // sentence is exactly the old behaviour, so narrowing can never truncate a
  // claim that has no clause of its own.
  it("falls back to the whole sentence when a clause is too thin to stand alone", () => {
    const [p] = citationPairs(`[As set out here](/atlas/${A}), the threshold is seven signers.`);
    expect(p.claim).toContain("the threshold is seven signers");
    expect(p.context).toBeUndefined();
  });

  it("adjacent links share the clause before them", () => {
    const pairs = citationPairs(`The threshold is seven signers [A](/atlas/${A}) [B](/atlas/${B}).`);
    expect(pairs).toHaveLength(2);
    expect(pairs[1].claim).toContain("seven signers");
  });
});

// A link right after a determiner or an open paren is a NOUN in the sentence,
// not a source marker. Dropping it left a hole: "the [Rate Limits](…) was
// updated" became "the was updated", which is not a claim at all. Observed
// 2026-09-28, and it hit hardest on the sentences `about_document` exists to
// catch, because it destroyed the words marking them as ABOUT the document.
describe("links used as nouns", () => {
  it("keeps the link text when a determiner leads it", () => {
    const [p] = citationPairs(`* Under the [Rate Limits](/atlas/${A}), the USDS burn limit is unlimited.`);
    expect(p.claim).toBe("Under the Rate Limits, the USDS burn limit is unlimited.");
  });

  // A parenthesis wrapping only the link is a source marker too, so the rule
  // is determiners alone. The empty parens get swept up as they always were.
  it("drops a link that a parenthesis merely wraps", () => {
    const [p] = citationPairs(`Documents regarding CRRs ([CRRs](/atlas/${A})) change often.`);
    expect(p.claim).toBe("Documents regarding CRRs change often.");
  });

  // The other shape: prose follows the link, but it is still an aside. Keeping
  // the title here would hand the judge the cited document's own name inside
  // the claim it is meant to check.
  it("drops it when the sentence already reads without it", () => {
    const pairs = citationPairs(
      `* They validate inputs for new agents [A](/atlas/${A}) and the setup of accords [B](/atlas/${B}).`,
    );
    expect(pairs[0].claim).toBe("They validate inputs for new agents");
    expect(pairs[0].claim).not.toContain("A");
  });

  // THE load-bearing one. A trailing citation is the overwhelming majority of
  // pairs, and its claim must stay byte-identical: `claim === whole` is what
  // keeps `context` off the pair, the request shape unchanged, and the
  // bakeoff's disk cache hitting.
  it("leaves an ordinary trailing citation exactly as it was", () => {
    const [p] = citationPairs(`The USDS burn rate limit is unlimited [Rate Limits](/atlas/${A}).`);
    expect(p.claim).toBe("The USDS burn rate limit is unlimited.");
    expect(p.context).toBeUndefined();
  });
});

// A document cannot state its own edit history, so pairing one with a sentence
// about when it changed asks a question with no honest answer. These shapes are
// unambiguous, so they never reach the judge.

// "Not stated in this source" on a sentence that was never a claim. Reported
// 2026-09-28. Two causes, both deterministic.
describe("sentences that are not claims", () => {
  it("makes no pair when the links WERE the claim", () => {
    // Stripping the list leaves "This affected documents such as", which the
    // judge then reads against a document and correctly calls unstated.
    expect(citationPairs(`This affected documents such as [Rate Limits](/atlas/${A}), [Swap](/atlas/${B}).`)).toEqual([]);
    expect(citationPairs(`The Distribution Reward Payments are: [List](/atlas/${A}).`)).toEqual([]);
    expect(citationPairs(`For the full set see [List](/atlas/${A}).`)).toEqual([]);
  });

  // A colon alone is NOT the signal. It regularly ends a claim with its own
  // substance that merely introduces examples, and a bare-colon rule threw
  // this real one away when it was first written.
  it("keeps a claim whose colon introduces examples", () => {
    expect(isLeadIn("All multisigs must adhere to two baseline standards unless explicitly exempted:")).toBe(false);
    expect(citationPairs(`All multisigs must adhere to two baseline standards [M](/atlas/${A}):`)).toHaveLength(1);
  });

  // The gate is about where a sentence ENDS, not what it contains, so an
  // ordinary claim carrying any of those words mid-sentence survives.
  it("leaves a real claim alone, including one containing the same words", () => {
    expect(isLeadIn("The USDS burn rate limit is unlimited.")).toBe(false);
    expect(isLeadIn("Documents such as this one are reviewed by Core GovOps.")).toBe(false);
    expect(citationPairs(`Documents such as this one are reviewed by Core GovOps [G](/atlas/${A}).`)).toHaveLength(1);
  });
});
