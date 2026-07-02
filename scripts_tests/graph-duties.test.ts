// Unit tests for the acting-role duty extractor (scripts/lib/graph-duties.mjs).
// Pure pattern tests — no build artifacts needed. Every case is a real shape
// from the atlas (doc_nos in comments), so a regression here means a known
// duty disappears or a known false positive returns.

import { describe, it, expect } from "vitest";
import {
  findGovOpsDuty,
  classifyGovOpsRole,
  findRoleDuty,
  classifyRole,
  DUTY_ROLES,
  // @ts-expect-error untyped .mjs build-script module
} from "../scripts/lib/graph-duties.mjs";

const FACILITATOR = DUTY_ROLES.find((r: { key: string }) => r.key === "facilitator");
const EXECUTOR = DUTY_ROLES.find((r: { key: string }) => r.key === "executor");

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

const FAC_ORGS = [
  { name: "Endgame Edge", role_declared: "Operational Facilitator" },
  { name: "JanSky", role_declared: "Core Facilitator" },
];
const findFac = (content: string, title = "Some Section") =>
  findRoleDuty(FACILITATOR, title, content, FAC_ORGS);

describe("findRoleDuty — facilitator", () => {
  it("matches the Core Facilitator as an empowered subject", () => {
    // A.1.1.2.1: Atlas Interpretations authority.
    expect(findFac("The Core Facilitator is authorized to conduct Atlas Interpretations to resolve ambiguities."))
      .toMatchObject({ role_declared: "Core Facilitator", match: "active" });
  });

  it("matches the Operational Facilitator in process steps", () => {
    // A.6.1.1.* Independent Governance path shape.
    expect(findFac("Under the Independent Governance path, the Operational Facilitator prepares and submits the Agent Artifact Edit Proposal."))
      .toMatchObject({ role_declared: "Operational Facilitator", match: "active" });
  });

  it("keeps bare plural 'Facilitators' as the universal role, not Operational", () => {
    // A.1.6 universal duties bind every Facilitator; labeling them
    // operational would be invented precision.
    const d = findFac("Facilitators must document their interpretations as Action Tenets.");
    expect(d).toMatchObject({ role_declared: "Facilitator", match: "active" });
  });

  it("matches by-anchored passives ('modified by Facilitators')", () => {
    // A.1.2.2.2.17 shape (the doc itself is excluded as a Type Specification,
    // but the pattern also carries A.2.* active-data prose).
    expect(findFac("This section contains variable state that can be directly modified by Facilitators."))
      .toMatchObject({ role_declared: "Facilitator", match: "passive" });
  });

  it("matches discretion phrases", () => {
    // A.1.9.1.1: emergency-situation discretion.
    expect(findFac("The Core Facilitator has broad discretion to apply the emergency-situation processes."))
      .toMatchObject({ role_declared: "Core Facilitator", match: "phrase" });
  });

  it("matches duty-container titles", () => {
    // A.1.6 "Facilitator Duties".
    expect(findRoleDuty(FACILITATOR, "Facilitator Duties", "The sections below describe them.", FAC_ORGS))
      .toMatchObject({ role_declared: "Facilitator", match: "title", quote: null });
  });

  it("ignores the Facilitator as the consulted party", () => {
    expect(findFac("The Governance Point, in consultation with the Core Facilitator, will publish the schedule."))
      .toBeNull();
  });

  it("rejects a new subject introduced after the Facilitator", () => {
    // Mirror of the GovOps ', the <Actor> <verb>' guard.
    expect(findFac("Following the assessment of the Core Facilitator, the Aligned Delegates must approve the change."))
      .toBeNull();
  });

  it("finds duties attributed by facilitator org name", () => {
    expect(findFac("Endgame Edge submits the compiled report to the forum."))
      .toMatchObject({ role_declared: "Operational Facilitator", match: "org", orgName: "Endgame Edge" });
  });
});

const EXEC_ORGS = [
  { name: "Amatsu", role_declared: "Operational Executor Agent" },
  { name: "Ozone", role_declared: "Operational Executor Agent" },
];
const findExec = (content: string, title = "Some Section") =>
  findRoleDuty(EXECUTOR, title, content, EXEC_ORGS);

describe("findRoleDuty — executor agent", () => {
  it("matches the Operational Executor Agent as an obligated subject", () => {
    // A.1.14.4.* shape.
    expect(findExec("Every Operational Executor Agent must have a Facilitator."))
      .toMatchObject({ role_declared: "Operational Executor Agent", match: "active" });
  });

  it("recognizes the 'Core Council Executor Agent' qualifier as Core", () => {
    // A.2.8.* Core Council authority shape.
    expect(findExec("The Core Council Executor Agents maintain operational authority over the Core Council Operational Multisig."))
      .toMatchObject({ role_declared: "Core Executor Agent", match: "active" });
  });

  it("does not title-match — executor title hits are structural stubs, not duties", () => {
    expect(findRoleDuty(EXECUTOR, "Operational Executor Agent", "Definitional stub content only.", EXEC_ORGS))
      .toBeNull();
  });

  it("finds duties attributed by executor org name", () => {
    // A.2.8.2.8.2.2: Amatsu transfer authorization.
    expect(findExec("Amatsu is authorized to transfer funds from its Genesis Capital Allocation."))
      .toMatchObject({ role_declared: "Operational Executor Agent", match: "org", orgName: "Amatsu" });
  });

  it("ignores the Executor Agent as the consulted party", () => {
    expect(findExec("The Prime Agent, in consultation with the Operational Executor Agent, will set the parameters."))
      .toBeNull();
  });
});

describe("classifyRole — bare labels per role", () => {
  it("keeps the bare label for facilitator and executor (universal duties)", () => {
    expect(classifyRole(FACILITATOR, "Duties", "Facilitators must document their actions.")).toBe("Facilitator");
    expect(classifyRole(EXECUTOR, "Duties", "The Executor Agent executes the transfer.")).toBe("Executor Agent");
  });

  it("prefers the title qualifier, then the earliest in content", () => {
    expect(classifyRole(FACILITATOR, "Core Facilitator Duties", "")).toBe("Core Facilitator");
    expect(classifyRole(EXECUTOR, "Transfers", "The Operational Executor Agent executes the transfer.")).toBe(
      "Operational Executor Agent",
    );
  });
});
