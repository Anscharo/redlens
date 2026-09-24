// Unit tests for persisted-verdict.ts's pure parsers — no SQL, no mocked
// modules. Moved here from conversations.test.ts's HTTP-level coverage where
// these were really testing the parsing/recompute logic through the route;
// the SQL/route-level tests (ownership, one-query-per-feature, wiring) stay
// in conversations.test.ts.
import { describe, expect, it } from "bun:test";
import {
  answerCoverageFromRow,
  checkReportForOverall,
  deterministicChecksFrom,
  judgedPairsFrom,
  restoreVerify,
  rulingIssuedFrom,
  storedOverall,
  verdictForOverall,
} from "./persisted-verdict.ts";
import type { AgreedContradiction } from "./disputes.ts";

describe("judgedPairsFrom", () => {
  it("parses a well-formed judged array", () => {
    const out = judgedPairsFrom({
      judged: [{ uuid: "doc-a", claim: "The fee is 10 bps.", verdict: "supports", confidence: 0.8 }],
    });
    expect(out).toEqual([{ uuid: "doc-a", claim: "The fee is 10 bps.", verdict: "supports", confidence: 0.8 }]);
  });

  it("returns null for a non-object verdict", () => {
    expect(judgedPairsFrom("not-an-object")).toBeNull();
    expect(judgedPairsFrom(null)).toBeNull();
  });

  it("returns null when `judged` is missing or not an array", () => {
    expect(judgedPairsFrom({ counts: {} })).toBeNull();
    expect(judgedPairsFrom({ judged: "nope" })).toBeNull();
  });

  it("drops individual malformed items rather than failing the whole row", () => {
    const out = judgedPairsFrom({
      judged: [
        { uuid: "doc-a", claim: "ok claim", verdict: "not_a_real_verdict" }, // unrecognised verdict
        { claim: "missing uuid" }, // no uuid
        { uuid: "doc-b", claim: "good one", verdict: "contradicts", confidence: 0.5 },
      ],
    });
    expect(out).toEqual([{ uuid: "doc-b", claim: "good one", verdict: "contradicts", confidence: 0.5 }]);
  });

  it("normalizes an out-of-range confidence to null via citeConfidence", () => {
    const out = judgedPairsFrom({ judged: [{ uuid: "doc-a", claim: "x", verdict: "supports", confidence: 5 }] });
    expect(out![0].confidence).toBeNull();
  });
});

describe("deterministicChecksFrom", () => {
  const validChecks = {
    invalidCitations: ["a"], invalidDocNos: [], docNoMismatches: [], ungroundedQuotes: [],
    ungroundedAddresses: [], ungroundedCitationValues: [], paramMismatches: [], completenessFailures: [],
    missingExternalDisclaimer: false, mscCitedAsAtlas: [], lengthCapped: false, failed: true,
  };

  it("parses a well-formed round_checks payload", () => {
    const det = deterministicChecksFrom({ checks: validChecks });
    expect(det).toEqual(validChecks);
  });

  it("returns null when `checks` is missing or not an object", () => {
    expect(deterministicChecksFrom({})).toBeNull();
    expect(deterministicChecksFrom({ checks: "nope" })).toBeNull();
    expect(deterministicChecksFrom(null)).toBeNull();
  });

  it("returns null when `checks.failed` is not a boolean — the one field every version has carried", () => {
    expect(deterministicChecksFrom({ checks: { ...validChecks, failed: "yes" } })).toBeNull();
  });

  it("filters non-string entries out of string-array fields rather than dropping the row", () => {
    const det = deterministicChecksFrom({ checks: { ...validChecks, invalidCitations: ["ok", 42, null, "also-ok"] } });
    expect(det!.invalidCitations).toEqual(["ok", "also-ok"]);
  });

  it("drops individually malformed paramMismatches entries", () => {
    const det = deterministicChecksFrom({
      checks: {
        ...validChecks,
        paramMismatches: [
          { stated: "5", actual: "7", name: "threshold", title: "T", uuid: "u1", doc_no: "A.1", owner: "Keel" },
          { stated: "missing fields" },
        ],
      },
    });
    expect(det!.paramMismatches).toEqual([
      { stated: "5", actual: "7", name: "threshold", title: "T", uuid: "u1", doc_no: "A.1", owner: "Keel" },
    ]);
  });
});

describe("checkReportForOverall", () => {
  it("carries `failed` through and defaults the fields computeOverall never reads", () => {
    const det = deterministicChecksFrom({
      checks: {
        invalidCitations: [], invalidDocNos: [], docNoMismatches: [], ungroundedQuotes: [],
        ungroundedAddresses: [], ungroundedCitationValues: [], paramMismatches: [], completenessFailures: [],
        missingExternalDisclaimer: false, mscCitedAsAtlas: [], lengthCapped: false, failed: true,
      },
    })!;
    const report = checkReportForOverall(det);
    expect(report.failed).toBe(true);
    expect(report.citations).toEqual([]);
    expect(report.bareAtlasLinks).toEqual([]);
    expect(report.uncitedParagraphs).toBe(0);
    expect(report.untracedNumbers).toEqual([]);
  });
});

describe("rulingIssuedFrom", () => {
  it("is true only when ruling_issued is exactly true", () => {
    expect(rulingIssuedFrom({ ruling_issued: true })).toBe(true);
    expect(rulingIssuedFrom({ ruling_issued: false })).toBe(false);
    expect(rulingIssuedFrom({ ruling_issued: "true" })).toBe(false);
    expect(rulingIssuedFrom(null)).toBe(false);
    expect(rulingIssuedFrom("not-an-object")).toBe(false);
  });
});

describe("storedOverall", () => {
  it("passes through a recognised overall value", () => {
    expect(storedOverall("warn")).toBe("warn");
    expect(storedOverall("fail")).toBe("fail");
  });

  it("degrades an unrecognised or null value to unverified", () => {
    expect(storedOverall(null)).toBe("unverified");
    expect(storedOverall("some-future-value")).toBe("unverified");
  });
});

describe("verdictForOverall", () => {
  it("builds contradictions from the `agreed` list handed in, not a second parse of the raw payload", () => {
    const agreed: AgreedContradiction[] = [{ answer: "The fee is 10 bps.", evidence: "The fee is 8 bps.", why: "mismatch", uuid: "doc-c" }];
    const v = verdictForOverall(
      { contradictions: [{ agreed: false }], ruling_issued: false, refuteParsed: true, confirm: null },
      agreed,
    );
    expect(v).not.toBeNull();
    expect(v!.contradictions).toEqual([
      { answer_span: "The fee is 10 bps.", evidence_span: "The fee is 8 bps.", why: "mismatch", evidence_label: "", uuid: "doc-c", source: "model", agreed: true },
    ]);
  });

  it("returns an empty contradictions array (not a fail-implying one) when `agreed` is empty, even if the raw payload has agreed:true entries", () => {
    // The §3 fix: a raw payload with `agreed: true` but a malformed span is
    // exactly what agreedContradictionsFrom (disputes.ts) filters out before
    // handing its result in here — this function must not resurrect it.
    const v = verdictForOverall(
      { contradictions: [{ answer_span: 123, evidence_span: "x", agreed: true }], ruling_issued: false, refuteParsed: true, confirm: null },
      [], // agreedContradictionsFrom would have dropped the malformed entry
    );
    expect(v!.contradictions).toEqual([]);
  });

  it("returns null for a non-object verdict, or one missing ruling_issued/refuteParsed", () => {
    expect(verdictForOverall("nope", [])).toBeNull();
    expect(verdictForOverall({ contradictions: [] }, [])).toBeNull(); // no ruling_issued/refuteParsed
  });

  it("returns null when `contradictions` on the raw payload isn't even an array — a shape check, not span validation", () => {
    expect(verdictForOverall({ contradictions: "nope", ruling_issued: false, refuteParsed: true }, [])).toBeNull();
  });

  it("returns null on a malformed confirm block", () => {
    expect(
      verdictForOverall({ contradictions: [], ruling_issued: false, refuteParsed: true, confirm: { ran: "yes" } }, []),
    ).toBeNull();
  });

  it("parses a well-formed confirm block", () => {
    const v = verdictForOverall(
      { contradictions: [], ruling_issued: true, refuteParsed: true, confirm: { ran: true, parsed: true, candidates: 2, model: "m", agreed: 1 } },
      [],
    );
    expect(v!.confirm).toEqual({ ran: true, parsed: true, candidates: 2, model: "m", agreed: 1 });
  });
});

describe("restoreVerify", () => {
  it("mirrors emitVerify: restores a fail badge from a round_checks row ALONE when its checks failed and there is no verify row", () => {
    const roundChecks = {
      checks: {
        invalidCitations: [], invalidDocNos: ["A.9.9.9"], docNoMismatches: [], ungroundedQuotes: [],
        ungroundedAddresses: [], ungroundedCitationValues: [], paramMismatches: [], completenessFailures: [],
        missingExternalDisclaimer: false, mscCitedAsAtlas: [], lengthCapped: false, failed: true,
      },
    };
    const out = restoreVerify(null, roundChecks);
    expect(out).not.toBeNull();
    expect(out!.status).toBe("fail");
    expect(out!.contradictions).toEqual([]);
    expect(out!.rulingIssued).toBe(false);
    expect(out!.invalidDocNos).toEqual(["A.9.9.9"]);
  });

  it("mirrors emitVerify the other way: restores null for a round_checks row alone whose checks did NOT fail", () => {
    const roundChecks = { checks: { invalidCitations: [], invalidDocNos: [], docNoMismatches: [], ungroundedQuotes: [], ungroundedAddresses: [], ungroundedCitationValues: [], paramMismatches: [], completenessFailures: [], missingExternalDisclaimer: false, mscCitedAsAtlas: [], lengthCapped: false, failed: false } };
    expect(restoreVerify(null, roundChecks)).toBeNull();
  });

  it("returns null with no verify row and no parseable round_checks row", () => {
    expect(restoreVerify(null, undefined)).toBeNull();
    expect(restoreVerify(null, "garbage")).toBeNull();
  });

  it("recomputes status via computeOverall when both rows parse, not the stored overall column", () => {
    const verifyRow = {
      overall: "fail", // stale/pre-confirm-gate value
      verdict: { contradictions: [], ruling_issued: false, refuteParsed: true, confirm: null },
    };
    const roundChecks = { checks: { invalidCitations: [], invalidDocNos: [], docNoMismatches: [], ungroundedQuotes: [], ungroundedAddresses: [], ungroundedCitationValues: [], paramMismatches: [], completenessFailures: [], missingExternalDisclaimer: false, mscCitedAsAtlas: [], lengthCapped: false, failed: false } };
    const out = restoreVerify(verifyRow, roundChecks);
    expect(out!.status).toBe("pass");
  });

  it("falls back to the stored overall column when the round_checks row is missing", () => {
    const verifyRow = { overall: "warn", verdict: { contradictions: [], ruling_issued: false, refuteParsed: true, confirm: null } };
    const out = restoreVerify(verifyRow, undefined);
    expect(out!.status).toBe("warn");
  });

  it("never produces a fail status alongside an empty contradictions list (the §3 fix, at the restoreVerify level)", () => {
    const verifyRow = {
      overall: "pass",
      verdict: {
        contradictions: [{ answer_span: 123, evidence_span: "The threshold is 5 signers.", agreed: true, uuid: "doc-c" }],
        ruling_issued: false, refuteParsed: true, confirm: null,
      },
    };
    const roundChecks = { checks: { invalidCitations: [], invalidDocNos: [], docNoMismatches: [], ungroundedQuotes: [], ungroundedAddresses: [], ungroundedCitationValues: [], paramMismatches: [], completenessFailures: [], missingExternalDisclaimer: false, mscCitedAsAtlas: [], lengthCapped: false, failed: false } };
    const out = restoreVerify(verifyRow, roundChecks);
    expect(out!.contradictions).toEqual([]);
    expect(out!.status).not.toBe("fail");
  });

  it("still recomputes fail when a contradiction is agreed AND well-formed", () => {
    const verifyRow = {
      overall: "pass",
      verdict: {
        contradictions: [{ answer_span: "The fee is 10 bps.", evidence_span: "The fee is 8 bps.", agreed: true, uuid: "doc-c" }],
        ruling_issued: false, refuteParsed: true, confirm: null,
      },
    };
    const roundChecks = { checks: { invalidCitations: [], invalidDocNos: [], docNoMismatches: [], ungroundedQuotes: [], ungroundedAddresses: [], ungroundedCitationValues: [], paramMismatches: [], completenessFailures: [], missingExternalDisclaimer: false, mscCitedAsAtlas: [], lengthCapped: false, failed: false } };
    const out = restoreVerify(verifyRow, roundChecks);
    expect(out!.contradictions.length).toBe(1);
    expect(out!.status).toBe("fail");
  });
});

describe("answerCoverageFromRow", () => {
  it("maps the stored {text,p}[] parts to the wire string[] shape", () => {
    const out = answerCoverageFromRow({
      verdict: "answers", probabilities: { answers: 0.9 },
      parts: [{ text: "what is the fee", p: 0.9 }, { text: "when it takes effect", p: 0.1 }],
      missingParts: ["when it takes effect"], rawToolOutput: false,
    });
    expect(out).toEqual({ verdict: "answers", missingParts: ["when it takes effect"], parts: ["what is the fee", "when it takes effect"] });
  });

  it("omits `parts` entirely when the stored array is empty, mirroring the live event's own omission rule", () => {
    const out = answerCoverageFromRow({ verdict: "declines", probabilities: null, parts: [], missingParts: [], rawToolOutput: false });
    expect(out).toEqual({ verdict: "declines", missingParts: [] });
    expect("parts" in out!).toBe(false);
  });

  it("never carries probabilities or rawToolOutput onto the wire shape", () => {
    const out = answerCoverageFromRow({ verdict: "asks", probabilities: { asks: 0.99 }, parts: [], missingParts: [], rawToolOutput: true });
    expect(Object.keys(out!)).not.toContain("probabilities");
    expect(Object.keys(out!)).not.toContain("rawToolOutput");
  });

  it("drops a malformed individual part rather than failing the whole row", () => {
    const out = answerCoverageFromRow({
      verdict: "answers", probabilities: null,
      parts: [{ text: "good part", p: 0.5 }, { p: 0.2 }, "not-an-object"],
      missingParts: [], rawToolOutput: false,
    });
    expect(out!.parts).toEqual(["good part"]);
  });

  it("degrades to null on an unrecognised verdict value rather than passing it through", () => {
    expect(answerCoverageFromRow({ verdict: "maybe", probabilities: null, parts: [], missingParts: [], rawToolOutput: false })).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(answerCoverageFromRow(null)).toBeNull();
    expect(answerCoverageFromRow("nope")).toBeNull();
  });
});
