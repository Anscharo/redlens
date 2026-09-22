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
