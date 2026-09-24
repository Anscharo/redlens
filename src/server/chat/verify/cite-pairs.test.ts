import { describe, expect, it } from "bun:test";
import { citationPairs, tablesAsProse } from "./cite-pairs.ts";

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
