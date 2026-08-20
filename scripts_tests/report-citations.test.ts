// Citation gate for Atlas-derived reports (scripts/lib/report-citations.mjs).
// Guards the CLAUDE.md "Citation dictate": normative claims in a report must
// carry an in-context Atlas reference (inline or a directly-referenced footnote).

import { describe, it, expect } from "vitest";
import {
  analyzeReportCitations,
  hasCitation,
  isNormativeClaim,
} from "../scripts/lib/report-citations.mjs";

describe("hasCitation", () => {
  it("recognizes atlas doc_nos, UUIDs, NR ids, and atlas links", () => {
    expect(hasCitation("per A.2.7.1.1.1.1.4.0.6.1 the threshold is set")).toBe(true);
    expect(hasCitation("see b71564fd-22e0-4c69-99d1-5b23fc1fa329")).toBe(true);
    expect(hasCitation("open research NR-12")).toBe(true);
    expect(hasCitation("https://atlas.redline.support/atlas?id=abc")).toBe(true);
    expect(hasCitation("/atlas?id=abc")).toBe(true);
  });
  it("does not fire on ordinary prose or non-atlas dotted tokens", () => {
    expect(hasCitation("the buffer needs funding soon")).toBe(false);
    expect(hasCitation("version 3.4.1 of the library")).toBe(false);
    expect(hasCitation("e.g. i.e. Fig.2 No.5")).toBe(false);
  });
});

describe("isNormativeClaim", () => {
  it("flags must / has to / needs to / should / thresholds", () => {
    expect(isNormativeClaim("the multisig must have 7 signers")).toBe(true);
    expect(isNormativeClaim("Skybase has to register the account")).toBe(true);
    expect(isNormativeClaim("this needs to be updated")).toBe(true);
    expect(isNormativeClaim("signers should rotate quarterly")).toBe(true);
    expect(isNormativeClaim("at least 3 approvers")).toBe(true);
    expect(isNormativeClaim("a minimum of 2 reviewers")).toBe(true);
    expect(isNormativeClaim("threshold ≥ 7")).toBe(true);
    expect(isNormativeClaim("this is prohibited")).toBe(true);
  });
  it("leaves descriptive prose alone", () => {
    expect(isNormativeClaim("the multisig currently has 5 signers")).toBe(false);
    expect(isNormativeClaim("Redline is the Operational Facilitator")).toBe(false);
  });
});

describe("analyzeReportCitations", () => {
  it("flags an uncited normative claim", () => {
    const md = "## Action Required\n\n- The multisig needs at least 7 signers.\n";
    const { uncited } = analyzeReportCitations(md);
    expect(uncited).toHaveLength(1);
    expect(uncited[0].text).toContain("7 signers");
  });

  it("passes when the claim cites inline", () => {
    const md = "- The multisig needs at least 7 signers (A.2.7.1.1.1.1.4).\n";
    const { claims, uncited } = analyzeReportCitations(md);
    expect(uncited).toHaveLength(0);
    expect(claims[0].via).toBe("inline");
  });

  it("passes when a Source table cell on the same row carries the doc_no", () => {
    const md = [
      "| Multisig | Requirement | Source |",
      "|---|---|---|",
      "| Spark | must keep threshold ≥ 7 | A.2.7.1.1 |",
    ].join("\n");
    const { uncited } = analyzeReportCitations(md);
    expect(uncited).toHaveLength(0);
  });

  it("passes when a directly-referenced footnote carries the citation", () => {
    const md = [
      "- The multisig needs at least 7 signers.[^t]",
      "",
      "[^t]: Per A.2.7.1.1.1.1.4 the threshold is fixed.",
    ].join("\n");
    const { claims, uncited } = analyzeReportCitations(md);
    expect(uncited).toHaveLength(0);
    expect(claims[0].via).toBe("footnote");
  });

  it("still flags when the footnote exists but itself lacks a citation", () => {
    const md = [
      "- The multisig needs at least 7 signers.[^t]",
      "",
      "[^t]: This is important for security.",
    ].join("\n");
    const { uncited } = analyzeReportCitations(md);
    expect(uncited).toHaveLength(1);
  });

  it("does NOT accept a detached trailing references section", () => {
    // A citation that the claim does not point at must not satisfy the rule.
    const md = [
      "- The multisig needs at least 7 signers.",
      "",
      "## References",
      "- A.2.7.1.1.1.1.4 — threshold controller",
    ].join("\n");
    const { uncited } = analyzeReportCitations(md);
    expect(uncited).toHaveLength(1);
  });

  it("treats a blockquote as cited when its attribution lead-in carries the doc_no", () => {
    const md = [
      "Threshold Requirements · A.2.11.1.3.2.1.1.2.1:",
      "",
      "> - Multisigs must have a minimum of three (3) signers.",
      "> - Multisigs must maintain a threshold of at least fifty percent (50%).",
    ].join("\n");
    const { claims, uncited } = analyzeReportCitations(md);
    expect(uncited).toHaveLength(0);
    // The quoted "must" lines are cited via their attribution lead-in.
    const quoteClaims = claims.filter((c) => c.text.startsWith(">"));
    expect(quoteClaims.length).toBeGreaterThan(0);
    expect(quoteClaims.every((c) => c.via === "quote-attribution")).toBe(true);
  });

  it("still flags a blockquote whose attribution lead-in has no citation", () => {
    const md = ["Some heading text with no reference:", "", "> Multisigs must have at least 7 signers."].join("\n");
    const { uncited } = analyzeReportCitations(md);
    expect(uncited).toHaveLength(1);
  });

  it("ignores normative words inside fenced code blocks", () => {
    const md = ["```bash", "# you must run this", 'echo "should work"', "```"].join("\n");
    const { claims } = analyzeReportCitations(md);
    expect(claims).toHaveLength(0);
  });

  it("does not treat headings as claims", () => {
    const md = "## What must change\n\nThe registry lists five signers (A.1.2).\n";
    const { claims } = analyzeReportCitations(md);
    expect(claims).toHaveLength(0);
  });
});
