// The subject check and the atlas-side claim reading (src/lib/votes/subject.ts, claim.ts).

import { describe, expect, it } from "vitest";

import { executiveVoteRef } from "./claim";
import { checkSubject, documentAddresses, SubjectCorpus, subjectTerms } from "./subject";

describe("subjectTerms", () => {
  it("keeps capitalised names, dropping months, doc_nos, sentence openers and the vote itself", () => {
    const clause = "The transfer of the Genesis Capital Allocation to Keel (see A.2.8.2.3.2.1) was included in the March 26, 2026 Executive Vote";
    expect(subjectTerms(clause)).toEqual(["genesis", "capital", "allocation", "keel"]);
  });

  it("keeps hyphenated names and acronyms, and deduplicates", () => {
    expect(subjectTerms("The PAS and the LSSKY-SKY rewards; the PAS again")).toEqual(["pas", "lssky-sky"]);
  });
});

describe("checkSubject", () => {
  // Ten executives: "usds" is in all of them, "genesis" in half, "skylink" in two, "bridge" in three.
  const texts = Array.from({ length: 10 }, (_, i) => {
    const words = ["usds"];
    if (i < 5) words.push("genesis");
    if (i < 2) words.push("skylink");
    if (i === 0 || i >= 8) words.push("bridge");
    return words.join(" ");
  });
  const corpus = new SubjectCorpus(texts);

  it("needs the rarest term present and at least half of the rare ones", () => {
    // skylink and bridge are both rare; text 1 has skylink only.
    expect(checkSubject(["skylink", "bridge"], texts[1], corpus).verdict).toBe("found");
    expect(checkSubject(["avalanche", "skylink"], texts[1], corpus)).toMatchObject({ verdict: "missing", missing: ["avalanche"] });
  });

  it("falls back to uncommon terms when none is rare, and ignores words every executive uses", () => {
    expect(checkSubject(["genesis", "usds"], texts[0], corpus)).toEqual({ verdict: "found", found: ["genesis"], missing: [] });
    expect(checkSubject(["genesis"], texts[7], corpus).verdict).toBe("missing");
    expect(checkSubject(["usds"], texts[0], corpus).verdict).toBe("unchecked");
    expect(checkSubject([], texts[0], corpus).verdict).toBe("unchecked");
  });

  it("matches a term at a word start, not inside another word", () => {
    expect(corpus.has("the sparkfoundation", "foundation")).toBe(false);
    expect(corpus.has("spark-foundation grant", "foundation")).toBe(true);
    expect(new SubjectCorpus([]).share("x")).toBe(0);
  });
});

describe("executiveVoteRef", () => {
  const at = (prose: string, date: string) => {
    const start = prose.indexOf(date);
    return executiveVoteRef(prose, start, start + date.length);
  };

  it("reads the subject from the clause before the date", () => {
    const prose = "Intro. The Kicker Module was activated in the October 30, 2025 Executive Vote. Next sentence names Spark.";
    expect(at(prose, "October 30, 2025")).toEqual({ outOfSchedule: false, anchor: false, subject: ["kicker", "module"] });
  });

  it("reads it after the date when the sentence opens with the vote, and marks a time anchor", () => {
    const prose = "Beginning with the June 18, 2026 Executive Vote, a completed Agent Spell Reviewer Checklist must be included.";
    expect(at(prose, "June 18, 2026")).toEqual({
      outOfSchedule: false,
      anchor: true,
      subject: ["agent", "spell", "reviewer", "checklist"],
    });
  });

  it("notes an out-of-schedule vote, and ignores a date that names no executive", () => {
    expect(at("The second phase occurred in the November 17, 2025 Out-Of-Schedule Executive Vote.", "November 17, 2025")?.outOfSchedule).toBe(true);
    expect(at("Payments begin on November 17, 2025 for every Prime.", "November 17, 2025")).toBeNull();
  });

  it("treats a line break as a sentence boundary", () => {
    const prose = "Osero Heading\nThe transfer was included in the March 26, 2026 Executive Vote";
    expect(at(prose, "March 26, 2026")?.subject).toEqual([]);
  });
});

describe("the address fallback for a renamed party", () => {
  const PARTY = "0x24fdcd3bfa5c2553e05b2f9ad0365ebc296278d3";
  const TOKEN = "0xdc035d45d973e3ec169d2276ddab16f1e407384f";
  // The party's address is in two of ten executives; the token's in all of them.
  const texts = Array.from({ length: 10 }, (_, i) => `transfer usds ${TOKEN}${i < 2 ? ` to the launch agent 6 subproxy (${PARTY})` : ""}`);
  const corpus = new SubjectCorpus(texts);

  it("reads a document's addresses, lowercased and deduplicated", () => {
    expect(documentAddresses(`SubProxy ${PARTY.toUpperCase().replace("0X", "0x")} and [link](https://etherscan.io/address/${PARTY})`)).toEqual([PARTY]);
    expect(documentAddresses("no address, and 0x123 is too short")).toEqual([]);
  });

  it("finds the subject through a rare address the names miss", () => {
    expect(checkSubject(["osero"], texts[0], corpus, [PARTY])).toEqual({ verdict: "found", found: [], missing: ["osero"], address: PARTY });
    expect(checkSubject(["osero"], texts[5], corpus, [PARTY]).verdict).toBe("missing");
  });

  it("never lets a common address stand in for a party, and leaves a names match alone", () => {
    expect(checkSubject(["osero"], texts[5], corpus, [TOKEN]).verdict).toBe("missing");
    const named = new SubjectCorpus([...texts, "osero grant"]);
    expect(checkSubject(["osero"], "osero grant", named, [PARTY])).not.toHaveProperty("address");
  });
});

