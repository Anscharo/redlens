// Unit tests for the acting-role duty extractor (scripts/lib/graph-duties.mjs).
// Pure pattern tests — no build artifacts needed. Every case is a real shape
// from the atlas (doc_nos in comments), so a regression here means a known
// duty disappears or a known false positive returns.

import { describe, it, expect } from "vitest";
import {
  findGovOpsDuty,
  classifyGovOpsRole,
  findRoleDuty,
  findRoleDuties,
  classifyRole,
  DUTY_ROLES,
  // @ts-expect-error untyped .mjs build-script module
} from "../scripts/lib/graph-duties.mjs";

const FACILITATOR = DUTY_ROLES.find((r: { key: string }) => r.key === "facilitator");
const EXECUTOR = DUTY_ROLES.find((r: { key: string }) => r.key === "executor");
const GOVOPS = DUTY_ROLES.find((r: { key: string }) => r.key === "govops");

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

  it("drops 'can be found' — an irregular passive participle the -ed/-en suffix check misses", () => {
    // A.1.14.3.4.2 (via the executor role): a cross-reference pointer, not a duty.
    expect(
      findExec(
        "More information about the role and function of Executor Agents can be found in the Executor Agents Section.",
      ),
    ).toBeNull();
  });

  it("keeps 'may be required to <verb>' — an obligation idiom, not a true passive", () => {
    // A.2.2.10.1.1.3.3: GovOps must act, not something being done to GovOps.
    expect(
      find(
        "In the event of any such violations, Operational GovOps may be required to take escalatory steps based on the fallback strategy in the Prime Agent Artifact.",
      ),
    ).toMatchObject({ role_declared: "Operational GovOps", match: "active" });
  });

  it("blocks a negated modal power ('will have no … authority')", () => {
    // A.1.15.1.2 (12286b6c): Atlas Axis is denied authority, not granted it.
    expect(find("Atlas Axis will have no decision-making authority in the Executive Vote workstreams.")).toBeNull();
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

  it("rejects a comma-less new subject introduced via 'then the <Actor>'", () => {
    // A.2.4.1.2.1.4 (0d561ea6): the Core Facilitator's obligation, not GovOps's.
    expect(
      find(
        "When Core GovOps has posted the Final Calculation then the Core Facilitator must include payments of these amounts in the next Sky Core Executive Vote as specified herein.",
      ),
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

  it("matches the 'processed'/'assigned' passives", () => {
    // A.2.2.9.1.2.1.1.2.1
    expect(
      find(
        "This on-chain deposit data is then combined with withdrawal data, which is further processed by Operational GovOps to estimate net deposits associated with the Reward Code.",
      ),
    ).toMatchObject({ role_declared: "Operational GovOps", match: "passive" });
    // A.2.2.11.1.4.2.1
    expect(
      find("Each eligible Integrator is assigned a unique Reward Code by Operational GovOps for the Prime Agent managing the relationship with the Integrator."),
    ).toMatchObject({ role_declared: "Operational GovOps", match: "passive" });
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

  it("matches 'controlled by' past an intervening indefinite NP", () => {
    // A.2.3.1.2.2.2.2 (05fa5c41): "is a multisig controlled by" — the copula
    // and "controlled by" aren't adjacent, unlike the plain roster shape.
    expect(find("The Aligned Delegates Buffer is a multisig controlled by the Core Facilitator and Core GovOps to transfer funds to Aligned Delegates."))
      .toMatchObject({ role_declared: "Core GovOps", match: "phrase" });
  });

  it("matches 'controlled by' past a coordinated or roster-fronted subject", () => {
    // A.6.1.1.4.3.4.2 (20ee784c): "two (2) signers from Operational GovOps …"
    expect(find("The USDS Demand Subsidies Multisig is controlled by two (2) signers from Operational GovOps Soter Labs and one (1) signer from Skybase Foundation."))
      .toMatchObject({ role_declared: "Operational GovOps", match: "phrase" });
  });

  it("matches nominalized power idioms ('subject to the approval of' / 'under the supervision of')", () => {
    // A.6.1.1.3.3.2 (41ad175e)
    expect(find("These deployments will be subject to the approval of Operational GovOps."))
      .toMatchObject({ role_declared: "Operational GovOps", match: "phrase" });
    // A.4.4.1.3.8.4.2 (bddf50ca)
    expect(
      find(
        "The wallet is controlled by Ecosystem Actor TechOps Services under the supervision of Core GovOps in consultation with the Core Council Risk Advisor.",
      ),
    ).toMatchObject({ role_declared: "Core GovOps", match: "phrase" });
  });

  it("matches an org-name colon-field role grant ('Curator: Soter Labs')", () => {
    // A.6.1.1.1.3.9.7.2.1 — Delegated Risk Curation instance details.
    const d = find("- Curator: Soter Labs, implemented via a Gnosis Safe multisig at `0x0f963A8A8c01042B69054e787E5763ABbB0646A3`, requiring a 3 of 5 signer approval threshold");
    expect(d).toMatchObject({ role_declared: "Operational GovOps", match: "org", orgName: "Soter Labs" });
  });
});

describe("quoteAt truncation window", () => {
  it("windows the quote around the match instead of truncating from line start", () => {
    // A.1.5.8 shape: an un-wrapped paragraph over 240 chars whose GovOps
    // mention sits near the end — truncating from the start would drop it.
    const filler =
      "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation. ";
    const content = `${filler}Formal allegations of such failure must be adjudicated by Core GovOps pursuant to the Adjudication Process.`;
    const d = find(content);
    expect(d?.match).toBe("passive");
    expect(d?.quote).toContain("adjudicated by Core GovOps");
    expect(d?.quote.startsWith("…")).toBe(true);
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

  it("matches 'initiates' as an active-obligation verb", () => {
    // A.1.10.2.3.2.2.3.3.2: the Operational-path half of a dual-path duty.
    expect(
      findFac(
        "Under the Independent Governance path, the Operational Facilitator initiates the vote in accordance with the voting process defined in the Prime Agent's Root Edit Primitive.",
      ),
    ).toMatchObject({ role_declared: "Operational Facilitator", match: "active" });
  });

  it("matches the Operational Facilitator in process steps", () => {
    // A.6.1.1.* Independent Governance path shape.
    expect(findFac("Under the Independent Governance path, the Operational Facilitator prepares and submits the Agent Artifact Edit Proposal."))
      .toMatchObject({ role_declared: "Operational Facilitator", match: "active" });
    // A.6.1.1.<n>.….4 "Root Edit Token Holder Vote": "triggers" is the only
    // actor verb in the agents-2–8 copies (agent 1 also has a discretion phrase).
    expect(findFac("Where their review results in a finding of alignment, the Operational Facilitator next triggers a Snapshot poll."))
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

describe("findRoleDuty — new-subject guard applies past the executor/facilitator boundary", () => {
  it("rejects a bare proper-noun new subject with no comma-'the' (A.2.2.1.1.13)", () => {
    // Amatsu/Ozone/Core Council Executor Agent 1 all fan out to this bare
    // "an Executor Agent" mention — "will" binds Core GovOps, introduced right
    // after the comma with no "the", not the Executor Agent named just before it.
    expect(
      findExec(
        "Now that the Agent has a documented relationship with an Executor Agent, Core GovOps will no longer perform validation of the Agent's Primitive inputs.",
      ),
    ).toBeNull();
  });

  it("rejects the same shape after a modal power grant (A.3.2.2.7.2.2.2)", () => {
    expect(
      findExec(
        "In the event that Core GovOps determines that the Operational Executor Agent is not appropriately supervising the activities of the Prime Agent, Core GovOps may terminate the respective Executor Accord.",
      ),
    ).toBeNull();
  });

  it("rejects it inside a longer intervening clause (A.1.14.3.4.2)", () => {
    expect(
      findExec(
        "To ensure clear direction for Executor Agents when executing Prime Agent strategies involving interaction with the Sky Protocol, Prime Agent Artifacts must include highly detailed and deterministic instructions.",
      ),
    ).toBeNull();
  });

  it("applies the guard to phrase-kind matches too, not just active (A.1.14.5.4)", () => {
    // Previously only "active" matches were guarded — this discretion-phrase
    // match ("the Executor Agent, the Core Facilitator has discretion…") slipped
    // through even though it fits the exact ", the <Actor> <verb>" FP shape.
    expect(
      findExec(
        "If there are operational disagreements between an Agent's Founder or Agent token holders and the Executor Agent, the Core Facilitator has discretion to direct the Executor Agent to take a particular action.",
      ),
    ).toBeNull();
  });
});

describe("findRoleDuty — citation links aren't prose", () => {
  it("ignores a role mention inside a cross-reference citation's own title (A.2.4.1.2.1.4.1)", () => {
    // The citation's title text ("…Made By Operational Executor Agents") reads
    // like a passive duty grant, but it's a reference to a DIFFERENT document.
    expect(
      findExec(
        "Amounts due to Prime Agents, excluding reimbursements made to Operational Executor Agents (see [A.2.4.1.2.1.4.3 - Reimbursement Of Payments Made By Operational Executor Agents](07c5cfd2-d68a-40d6-873d-b82cea9a92be)), are transferred from the Sky Surplus Buffer to the Prime SubProxy Account through an Executive Vote.",
      ),
    ).toBeNull();
  });

  it("still matches live prose reading like a citation title, when it isn't inside brackets", () => {
    expect(findExec("Reimbursement Of Payments Made By Operational Executor Agents is settled monthly."))
      .toMatchObject({ match: "passive" });
  });
});

describe("classifyRole — scoped to the matched sentence, not the whole doc", () => {
  it("classifies a bare/universal duty as bare even when a later sentence names the Core role (A.1.6.6)", () => {
    // The FIRST sentence ("The Facilitator must act swiftly…") is a universal
    // duty; a "Core Facilitator" escalation appears only in a LATER sentence.
    // Whole-document scoping previously let that later mention leak backward.
    const d = findFac(
      "The Facilitator must act swiftly when an AD is suspected of breaching the requirements defined in this Article. Formal allegations of such failure must be adjudicated by the Core Facilitator pursuant to the adjudication process.",
    );
    expect(d).toMatchObject({ role_declared: "Facilitator", match: "active" });
  });

  it("still classifies Core when the qualifier is in the SAME sentence as the match", () => {
    const d = findFac("The Core Facilitator must mediate the dispute between the Agent and the Executor Agent.");
    expect(d).toMatchObject({ role_declared: "Core Facilitator" });
  });

  it("scopes a title-match's classification to the first paragraph, not the whole doc (A.1.6.6)", () => {
    // Title "Swift Action Is Required From Facilitators…" title-matches bare
    // (no Core/Operational qualifier in the title itself); the doc's first
    // paragraph is a universal duty, and a Core-only escalation clause only
    // shows up two paragraphs later — that later mention must not win.
    const d = findRoleDuty(
      FACILITATOR,
      "Swift Action Is Required From Facilitators To Redress AD Misalignment",
      "The Facilitator must act swiftly when an AD is suspected of breaching the requirements defined in this Article.\n\nAny Facilitator has the authority to formally raise an allegation of AD misalignment with the Core Facilitator, which then obligates the latter to initiate a formal adjudication.\n\nFormal allegations of such failure must be adjudicated by the Core Facilitator pursuant to the same process.",
      [],
    );
    expect(d).toMatchObject({ role_declared: "Facilitator", match: "title" });
  });

  it("doesn't mistake a doc-number citation's internal dots for a sentence boundary", () => {
    // A.1.6.6 (real shape): the first sentence cites "[A.1.5 - …]" before its
    // own period — "A.1.5"'s internal dots must not truncate the scope early
    // and hide the fact that this sentence has no Core/Operational qualifier.
    const d = findFac(
      "The Facilitator must act swiftly when an AD is suspected of breaching the requirements defined in [A.1.5 - Alignment Conservers](df4f9bfd-e743-44b5-9c62-9c5f10b15340). Formal allegations of such failure must be adjudicated by the Core Facilitator pursuant to the same process.",
    );
    expect(d).toMatchObject({ role_declared: "Facilitator", match: "active" });
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

describe("findRoleDuties — dual-path docs with a genuine Core AND Operational duty", () => {
  const findFacDuties = (content: string, title = "Some Section") => findRoleDuties(FACILITATOR, title, content, []);
  const findGovDuties = (content: string, title = "Some Section") => findRoleDuties(GOVOPS, title, content, ORGS);

  it("finds both branches of a 'Sky Governance path / Independent Governance path' split", () => {
    // A.1.10.2.3.2.2.3.3.2
    const duties = findFacDuties(
      "Under the Sky Governance path, the Core Facilitator publishes the Governance Poll on the Sky voting portal. Aligned Delegates vote on the Governance Poll.\n\nUnder the Independent Governance path, the Operational Facilitator initiates the vote in accordance with the voting process defined in the Prime Agent's Root Edit Primitive.",
    );
    expect(duties).toHaveLength(2);
    expect(duties.map((d: { role_declared: string }) => d.role_declared).sort()).toEqual([
      "Core Facilitator",
      "Operational Facilitator",
    ]);
    expect(duties.every((d: { quote: string | null }) => d.quote)).toBe(true);
  });

  it("finds both branches of an 'if in the Sky Core Atlas / if in an Agent Artifact' split", () => {
    // A.1.13.1.3.1
    const duties = findFacDuties(
      "The Responsible Party must post their proposed changes to the Active Data. If the Active Data document is located in the Sky Core Atlas, then the Core Facilitator must confirm that the Responsible Party has the authority to request a Direct Edit. If the Active Data document is located in an Agent Artifact, then it is the Operational Facilitator for that Agent that must confirm the Responsible Party's authority to request a Direct Edit.",
    );
    expect(duties.map((d: { role_declared: string }) => d.role_declared).sort()).toEqual([
      "Core Facilitator",
      "Operational Facilitator",
    ]);
  });

  it("finds two independent duties with no branching language at all", () => {
    // A.3.2.2.7.2.1.2
    const duties = findGovDuties(
      "Core GovOps may require the Prime Agent to issue additional tokens and sell them to the extent it deems necessary. Operational GovOps will assist Core GovOps in executing any such transaction.",
    );
    expect(duties.map((d: { role_declared: string }) => d.role_declared).sort()).toEqual([
      "Core GovOps",
      "Operational GovOps",
    ]);
  });

  it("stops at one Core + one Operational, not every mention", () => {
    // A.2.2.10.1.1.3.3-shaped: three GovOps mentions, only two distinct qualifiers.
    const duties = findGovDuties(
      "Core GovOps reviews yields and obligations, applying penalties retroactively. In the event of any such violations, Operational GovOps may be required to take escalatory steps. Core GovOps also documents the outcome.",
    );
    expect(duties).toHaveLength(2);
  });

  it("still returns a single result for an ordinary single-duty doc", () => {
    expect(findGovDuties("Core GovOps must review such reports promptly.")).toEqual([
      { role_declared: "Core GovOps", match: "active", quote: "Core GovOps must review such reports promptly." },
    ]);
  });

  it("prefers a grounded content match over a bare title guess, when content has one", () => {
    // A.1.10.2.4.13.5: title "Facilitator Updates Atlas To Reflect Spell
    // Outcome" bare-title-matches, but the content itself names both
    // qualifiers with their own verbs — that's strictly better evidence.
    const duties = findFacDuties(
      "Following the successful execution of a Spell, the Atlas must be updated to accurately reflect the resulting changes. The Core Facilitator is responsible for ensuring that all relevant Sky Core Atlas documents are modified. For modifications pertaining to Agent Artifacts, the Operational Facilitator for the affected Agent is responsible for carrying out the required follow-up changes.",
      "Facilitator Updates Atlas To Reflect Spell Outcome",
    );
    expect(duties.every((d: { match: string }) => d.match !== "title")).toBe(true);
    expect(duties.map((d: { role_declared: string }) => d.role_declared).sort()).toEqual([
      "Core Facilitator",
      "Operational Facilitator",
    ]);
  });

  it("still falls back to a title match when content has nothing verb-anchored", () => {
    expect(findRoleDuties(FACILITATOR, "Facilitator Duties", "The sections below describe them.", [])).toEqual([
      { role_declared: "Facilitator", match: "title", quote: null },
    ]);
  });
});
