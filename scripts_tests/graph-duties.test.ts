// Unit tests for the GovOps duty extractor (scripts/lib/graph-duties.mjs).
// Pure pattern tests — no build artifacts needed. Every case is a real shape
// from the atlas (doc_nos in comments), so a regression here means a known
// duty disappears or a known false positive returns.

import { describe, it, expect } from "vitest";
// @ts-expect-error untyped .mjs build-script module
import { findGovOpsDuty, classifyGovOpsRole } from "../scripts/lib/graph-duties.mjs";

const ORGS = [
  { name: "Soter Labs", role_declared: "Operational GovOps" },
  { name: "Atlas Axis", role_declared: "Core GovOps" },
];

const find = (content: string, title = "Some Section") => findGovOpsDuty(title, content, ORGS);

describe("findGovOpsDuty — active voice", () => {
  it("matches an obligation verb with GovOps as subject", () => {
    const d = find("Core GovOps must review such reports promptly."); // A.1.3.2.4
    expect(d).toMatchObject({ role_declared: "Core GovOps", match: "active" });
    expect(d.quote).toContain("must review");
  });

  it("matches modal powers (may impose / can designate)", () => {
    expect(find("Core GovOps may impose whatever restrictions it deems necessary.")) // A.3.2.2.7.2.1.3
      .toMatchObject({ match: "active" });
    expect(find("Core GovOps can designate Ecosystem Actors as support actors.")) // A.2.1.1.3
      .toMatchObject({ match: "active" });
  });

  it("matches copula powers with an intervening adverb, but never negated", () => {
    // A.1.5.8.0.4.1: "…Core GovOps, who is then empowered to initiate…"
    expect(find("Concerns go to Core GovOps, who is then empowered to initiate the process."))
      .toMatchObject({ match: "active" });
    expect(find("Core GovOps is not empowered to act unilaterally.")).toBeNull();
  });

  it("keeps 'will be able to' (not a passive) but drops 'will be embedded'", () => {
    expect(find("Core GovOps will be able to seize this collateral.")) // A.3.2.2.7.2.2.1
      .toMatchObject({ match: "active" });
    // A.1.15.1.2 shape: the subject is the patient of a modal passive.
    expect(find("The values agreed with GovOps must be added to the Executive Sheet.")).toBeNull();
  });

  it("normalizes the spaceless 'CoreGovOps' spelling", () => {
    // A.2.2.1.1.13: "CoreGovOps reviews the inputs…"
    expect(find("CoreGovOps reviews the inputs to the Executor Accord Primitive."))
      .toMatchObject({ role_declared: "Core GovOps", match: "active" });
  });
});

describe("findGovOpsDuty — guards against misattribution", () => {
  it("ignores the 'GovOps meeting' / 'govops channel' noun compounds", () => {
    // A.1.10.2.4.3.2: the mandated actor is the Governance Point.
    expect(find("After the GovOps meeting, the Governance Point must do the items specified.")).toBeNull();
    // A.1.10.2.4.2.3.2: the actor is the Spell Crafter.
    expect(find("During the GovOps meeting the Spell Crafter will confirm the values.")).toBeNull();
    expect(find("Stakeholders communicate in the govops channel in Slack and must respond.")).toBeNull();
  });

  it("ignores GovOps as the consulted party", () => {
    // A.3.3.2.4.1.1: the Risk Advisor develops the tool.
    expect(
      find("The Core Council Risk Advisor, in consultation with Core GovOps, will develop a tool."),
    ).toBeNull();
  });

  it("keeps GovOps as subject when GovOps is the one consulting others", () => {
    // A.1.9.1.6: "Core GovOps, in consultation with the PSW Lead, must regularly evaluate…"
    expect(
      find("Core GovOps, in consultation with the Protocol Security Workstream Lead, must regularly evaluate preparedness."),
    ).toMatchObject({ match: "active" });
  });

  it("rejects a new subject introduced after GovOps (', the <Actor> <verb>')", () => {
    // A.1.14.2.10.2.6: the Core Facilitator resolves, not GovOps.
    expect(
      find("If the Agent disagrees with the final set of findings of Core GovOps, the Core Facilitator resolves the dispute."),
    ).toBeNull();
  });

  it("keeps a joint-subject list ('GovOps, the Core Facilitator, and the ADs must…')", () => {
    // A.1.3.2.2: joint review obligation.
    expect(
      find("Core GovOps, the Core Facilitator, and the Aligned Delegates must review modifications."),
    ).toMatchObject({ match: "active" });
  });

  it("ignores cross-references ('GovOps for Ozone are specified in A.6.1.2.2')", () => {
    expect(
      find("The Operational Facilitator and Operational GovOps for Ozone are specified in A.6.1.2.2."),
    ).toBeNull();
  });
});

describe("findGovOpsDuty — passive voice", () => {
  it("matches by-anchored passives, including power participles", () => {
    // A.1.9.1.2.4
    expect(find("Membership must be reviewed and approved by Core GovOps prior to joining."))
      .toMatchObject({ match: "passive" });
    // A.1.7.5
    expect(find("Any allegations of this abuse must be adjudicated by Core GovOps.")).toMatchObject({ match: "passive" });
    // A.1.10.2.1.13
    expect(find("The Executive Process Liaison role is currently held by Core GovOps.")).toMatchObject({ match: "passive" });
    // A.4.4.1.3.8.3
    expect(find("All stUSDS BEAM parameters can be modified by Core GovOps.")).toMatchObject({ match: "passive" });
  });
});

describe("findGovOpsDuty — power phrases", () => {
  it("matches 'at the discretion of GovOps'", () => {
    // A.1.9.1.2.1
    expect(find("The membership may change at the discretion of Core GovOps.")).toMatchObject({ match: "phrase" });
  });

  it("matches 'has the ability to' and 'have full discretion'", () => {
    // A.3.7.1.1.5
    expect(find("Core GovOps, in consultation with the Risk Advisor, has the ability to modify any parameters."))
      .toMatchObject({ match: "phrase" });
    // A.1.10.2.3.2.2.1.3.3 — caught by the active pattern ("determine" is a
    // listed verb) before the phrase pattern is consulted; either way it's in.
    expect(find("The Core Facilitator and Core GovOps have full discretion to determine whether an incident occurred."))
      .toMatchObject({ role_declared: "Core GovOps" });
    // The phrase pattern is load-bearing when the granted power has no listed verb.
    expect(find("The Core Facilitator and Core GovOps have full discretion over such usage."))
      .toMatchObject({ match: "phrase" });
  });

  it("matches multisig control ('is controlled by') but not signer rosters", () => {
    // A.3.7.1.3.5.1
    expect(find("The Operator Multisig is controlled by Core GovOps.")).toMatchObject({ match: "phrase" });
    // A.3.7.1.3.5.1.3 — a custody roster, not the control declaration.
    expect(find("The signers of the Operator Multisig are three (3) addresses controlled by Core GovOps.")).toBeNull();
  });
});

describe("findGovOpsDuty — titles and org names", () => {
  it("matches GovOps titles with no content signal, without a quote", () => {
    const d = findGovOpsDuty("Operational GovOps Review", "The materials are contained herein.", ORGS);
    expect(d).toMatchObject({ role_declared: "Operational GovOps", match: "title", quote: null });
  });

  it("does not treat 'GovOps Meeting' titles as duties", () => {
    expect(findGovOpsDuty("GovOps Meeting Checklist", "The checklist outlines discussion points.", ORGS)).toBeNull();
    expect(findGovOpsDuty("Sky Core GovOps Meeting", "The meeting includes review of content.", ORGS)).toBeNull();
  });

  it("finds duties attributed by org name and returns the matched org", () => {
    // A.1.10.2.3.2.2.3.2.4
    const d = find("Under the Sky Governance path, Atlas Axis drafts the Atlas Edit Proposal.");
    expect(d).toMatchObject({ role_declared: "Core GovOps", match: "org", orgName: "Atlas Axis" });
  });

  it("finds org-name passives", () => {
    const d = find("The proposal must be incorporated by Atlas Axis into the Atlas.");
    expect(d).toMatchObject({ match: "org", orgName: "Atlas Axis" });
  });
});

describe("classifyGovOpsRole", () => {
  it("prefers the title, then the earliest role in content, defaulting Operational", () => {
    expect(classifyGovOpsRole("Core GovOps Validates Inputs", "")).toBe("Core GovOps");
    expect(classifyGovOpsRole("Validation", "Operational GovOps validates the inputs.")).toBe("Operational GovOps");
    expect(classifyGovOpsRole("Validation", "GovOps must act.")).toBe("Operational GovOps");
  });
});
