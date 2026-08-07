// Unit tests for Phase 1 entity extraction (scripts/lib/graph-entities.mjs).
// Complements graph-entity-edges-drift.test.ts (empty-corpus drift signals):
// this corpus is realistic and non-empty, exercising the actual extraction
// patterns documented in .claude/skills/parse-atlas/SKILL.md. Doc_nos are
// cited in comments per repo convention (real or realistic shapes; never
// used as a runtime identifier here — that's fine in test fixtures).

import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractEntities } from "../scripts/lib/graph-entities.mjs";
import {
  ERG_MEMBERSHIP_UUID,
  ALIGNED_DELEGATES_UUID,
  RANKED_DELEGATE_UUIDS,
  SPELL_TEAM_UUID,
  ACTIVE_ECOSYSTEM_ACTORS_UUID,
  // @ts-expect-error — .mjs without types; runtime-only import.
} from "../scripts/lib/graph-patterns.mjs";
import type { AtlasNode } from "../src/types";

afterEach(() => vi.restoreAllMocks());

function silence() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
}

function uid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function mkDoc(overrides: {
  id: string;
  doc_no: string;
  title: string;
  type?: string;
  parentId?: string | null;
  content?: string;
  addressRefs?: string[];
}): AtlasNode {
  return {
    id: overrides.id,
    doc_no: overrides.doc_no,
    title: overrides.title,
    type: overrides.type ?? "Core",
    depth: Math.min(overrides.doc_no.split(".").length - 1, 6),
    parentId: overrides.parentId ?? null,
    content: overrides.content ?? "",
    order: 0,
    addressRefs: overrides.addressRefs ?? [],
  };
}

// Builds one realistic, non-empty atlas corpus exercising the extraction
// patterns cataloged in the parse-atlas skill. Frequency-prioritized per the
// real build: responsible_party_for, process_step_responsible_party_for,
// comprises, ecosystem_accord, erg_member_for, prime_agent_for,
// operational_executor_agent_for, proxies_to are all covered below.
function buildCorpus() {
  const sparkDoc = mkDoc({ id: uid(1), doc_no: "A.6.1.1.1", title: "Spark" });
  const groveDoc = mkDoc({ id: uid(2), doc_no: "A.6.1.1.2", title: "Grove" });

  const ozoneDoc = mkDoc({ id: uid(3), doc_no: "A.6.1.2.1", title: "Operational Executor Agent Ozone" });
  const coreExec1Doc = mkDoc({ id: uid(4), doc_no: "A.6.1.2.2", title: "Core Council Executor Agent 1" });

  const ozoneFacDoc = mkDoc({
    id: uid(5),
    doc_no: "A.6.1.2.1.1",
    title: "Operational Executor Facilitator",
    parentId: ozoneDoc.id,
    content: "The Operational Facilitator for Operational Executor Agent Ozone is Redline Facilitation Group.",
  });
  const ozoneGovDoc = mkDoc({
    id: uid(6),
    doc_no: "A.6.1.2.1.2",
    title: "Operational GovOps",
    parentId: ozoneDoc.id,
    content: "Operational GovOps for Operational Executor Agent Ozone is Soter Labs.",
  });
  const core1FacDoc = mkDoc({
    id: uid(7),
    doc_no: "A.6.1.2.2.1",
    title: "Core Executor Facilitator",
    parentId: coreExec1Doc.id,
    content: "The Facilitator for Core Council Executor Agent 1 is JanSky.",
  });
  const core1GovDoc = mkDoc({
    id: uid(8),
    doc_no: "A.6.1.2.2.2",
    title: "Core GovOps",
    parentId: coreExec1Doc.id,
    content: "GovOps for Core Council Executor Agent 1 is Soter Labs.",
  });

  // Pattern 3: cites the executor's defining doc; parentId walks 1 hop to Spark.
  const opExecParamDoc = mkDoc({
    id: uid(9),
    doc_no: "A.6.1.1.1.2.2.1.2.1.1.1.1",
    title: "Operational Executor Agent",
    parentId: sparkDoc.id,
    content: `See [Ozone](${ozoneDoc.id}).`,
  });
  const coreExecParamDoc = mkDoc({
    id: uid(10),
    doc_no: "A.6.1.1.1.2.2.1.2.1.1.1.2",
    title: "Core Executor Agent",
    parentId: sparkDoc.id,
    content: `See [Core Council Executor Agent 1](${coreExec1Doc.id}).`,
  });

  // Pattern 4/12: A.2.8.2.2 "Prime Program" (Sky + Spark + Grove + Moonbow),
  // mirroring the real accord shape including the atomic Moonbow party and a
  // single-member party (Ozone) whose member strips to an existing agent.
  const accordDoc = mkDoc({
    id: uid(11),
    doc_no: "A.2.8.2.2",
    title: "Prime Program",
    content: "The subdocuments herein record the terms of agreement between Sky, Grove, and Spark as agreed in Ecosystem Accord 2.",
  });
  const skyPartyDoc = mkDoc({
    id: uid(12),
    doc_no: "A.2.8.2.2.1.1.1",
    title: "Sky Details",
    content: "The party ‘Sky’ comprises Sky Core.",
  });
  const sparkPartyDoc = mkDoc({
    id: uid(13),
    doc_no: "A.2.8.2.2.1.1.2",
    title: "Spark Details",
    content: "The party ‘Spark’ comprises the Spark Prime Agent, Spark Foundation, and Phoenix Labs.",
  });
  const moonbowPartyDoc = mkDoc({
    id: uid(14),
    doc_no: "A.2.8.2.2.1.1.4",
    title: "Moonbow Details",
    content: "The party ‘Moonbow’ is the entity owning relevant intellectual property.",
  });
  const ozonePartyDoc = mkDoc({
    id: uid(16),
    doc_no: "A.2.8.2.2.1.1.5",
    title: "Ozone Details",
    content: "The party ‘Ozone’ comprises the Ozone Executor Agent.",
  });

  // Pattern: grant recipients (1l) — all three bullet shapes.
  const grantDoc1 = mkDoc({
    id: uid(17),
    doc_no: "A.2.13.1.1.1",
    title: "August 2025 Grant",
    content:
      "The approved and disbursed August 2025 grant to the Sky Frontier Foundation is as follows:\n\n- Recipient: Sky Frontier Foundation\n- Recipient Address: `0xca5183fb9997046fbd9ba8113139bf5a5af122a0`\n- USDS amount: 50,000,000",
    addressRefs: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"],
  });
  const grantDoc2 = mkDoc({
    id: uid(18),
    doc_no: "A.2.13.1.2.1",
    title: "September 2025 Grant",
    content: "* Recipient: Vertex Labs\n* Recipient Address: `0x1111111111111111111111111111111111111a`",
  });
  const grantDoc3 = mkDoc({
    id: uid(19),
    doc_no: "A.2.13.1.1.2",
    title: "October 2025 Grant",
    content: "Recipient: Sky Fortification Foundation\nRecipient Address: `0x2222222222222222222222222222222222222b`",
  });

  // Pattern 11: A.1.7.1 Active Ecosystem Actors walk → role def → .2 binding doc.
  const aeaDoc = mkDoc({
    id: ACTIVE_ECOSYSTEM_ACTORS_UUID,
    doc_no: "A.1.7.1",
    title: "Active Ecosystem Actors",
    type: "Section",
    content: "Active or Incubating Ecosystem Actors work according to the specifications of the Atlas.",
  });
  const roleDefDoc = mkDoc({
    id: uid(22),
    doc_no: "A.1.7.1.1",
    title: "Core Council Risk Advisor",
    content: "The Core Council Risk Advisor advises the Core Council on risk matters.",
  });
  const bindingDoc = mkDoc({
    id: uid(23),
    doc_no: "A.1.7.1.1.2",
    title: "Designated Core Council Risk Advisor",
    content: "The Core Council Risk Advisor role is held by BA Labs.",
  });
  // 1k1: a "Designated ..." binding doc outside the A.1.7.1 walk (e.g. Synome).
  const synomeBindingDoc = mkDoc({
    id: uid(24),
    doc_no: "A.1.3.2.1.1",
    title: "Designated Synome Editor",
    content: "The Synome Editor role is held by Archon Tech.",
  });

  const spellTeamDoc = mkDoc({
    id: SPELL_TEAM_UUID,
    doc_no: "A.1.10.2.2.2.1",
    title: "Spell Team Configuration",
    content:
      "The Spell Team consists of the Crafter(s) and Reviewers for a designated Spell.\n\nCurrently, Sky has two teams of technical contributors for Spell development, Dewiz, and Sidestream. They rotate the responsibility.",
  });

  // Pattern 7. Phoenix Labs is already an entity (via the accord); Chronicle
  // Labs is new — exercises both the dedupe-skip and fresh-create branches.
  const ergDoc = mkDoc({
    id: ERG_MEMBERSHIP_UUID,
    doc_no: "A.1.9.1.2.2.0.6.1",
    title: "Emergency Response Group Current Membership",
    type: "Active Data",
    content: "The members of the Emergency Response Group are:\n\n- Phoenix Labs\n- Chronicle Labs",
  });

  // Pattern 10 (1i): list-item path. BLUE is pre-created via addresses.json
  // (below) to exercise the entityMap.has dedupe-skip branch too.
  const alignedDelegatesDoc = mkDoc({
    id: ALIGNED_DELEGATES_UUID,
    doc_no: "A.1.6.1.5.0.6.1",
    title: "Current Aligned Delegates",
    type: "Active Data",
    content: "The Aligned Delegates are:\n\n- BLUE\n- Cloaky",
  });

  const rankedL1Doc = mkDoc({
    id: RANKED_DELEGATE_UUIDS.get(1),
    doc_no: "A.1.6.4.1.1.3.1",
    title: "Current Level 1 Ranked Delegates",
    content: "The current Level 1 Ranked Delegates are BLUE and Cloaky.",
  });
  const rankedL2Doc = mkDoc({
    id: RANKED_DELEGATE_UUIDS.get(2),
    doc_no: "A.1.6.4.1.2.3.1",
    title: "Current Level 2 Ranked Delegates",
    content: "The current Level 2 Ranked Delegate is Bonapublica.",
  });

  // Pattern 6 (responsible_party_for): direct / chain (no agent context) /
  // chain (agent context) / role-binding / unresolved (no RP) / unresolved
  // (descriptive phrase).
  const adc1 = mkDoc({
    id: uid(20),
    doc_no: "A.1.1.3.1",
    title: "Atlas Interpretations",
    type: "Active Data Controller",
    content: "- The Responsible Party is the Core Facilitator.\n- The Update Process must follow the protocol for ‘Direct Edit’.",
  });
  const adc2 = mkDoc({
    id: uid(21),
    doc_no: "A.1.5.10.2",
    title: "Derecognition Recording",
    type: "Active Data Controller",
    content: "The Responsible Party is Core Council Risk Advisor.",
  });
  const adc3 = mkDoc({
    id: uid(25),
    doc_no: "A.1.6.1.5",
    title: "List Of Recognized Aligned Delegates",
    type: "Active Data Controller",
    content: "The Responsible Party is Redline Facilitation Group.",
    addressRefs: ["0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee5"],
  });
  const adc4 = mkDoc({
    id: uid(26),
    doc_no: "A.1.9.1.2.2",
    title: "Emergency Response Group Membership",
    type: "Active Data Controller",
    content: "This section has no responsible party declaration.",
  });
  const adc5 = mkDoc({
    id: uid(27),
    doc_no: "A.2.7.1.1.1.1.4",
    title: "Registration Entity Field",
    type: "Active Data Controller",
    content: "The Responsible Party is the entity to which the registration pertains.",
  });
  const adc6 = mkDoc({
    id: uid(28),
    doc_no: "A.6.1.1.1.3.9.1",
    title: "Spark Reward Calculation Record",
    type: "Active Data Controller",
    content: "The Responsible Party is Operational GovOps.",
  });

  // process_step_responsible_party_for: multiple declarations per doc,
  // automation brackets, dedupe, and a fully unresolved doc.
  const stepDoc1 = mkDoc({
    id: uid(29),
    doc_no: "A.2.2.9.1.2.3.1.3",
    title: "Required Primitive Inputs",
    content:
      "- Drafting of Initial Planning Document\n    - Responsible Party: Redline Facilitation Group\n- Initial Planning Document Triggered For GovOps Review\n    - Responsible Party: Operational GovOps [automated]\n- Final Review\n    - Responsible Party: Operational GovOps.",
  });
  const stepDoc2 = mkDoc({
    id: uid(30),
    doc_no: "A.2.2.9.1.2.3.2.3",
    title: "Required Primitive Inputs",
    content: "- Responsible Party: Unknown Ghost Committee",
  });

  // duty_for (2s-ter): active/passive/bare-label fan-out across all 3 roles.
  const dutyDoc1 = mkDoc({ id: uid(31), doc_no: "A.3.5.1", title: "Reporting Review", content: "Core GovOps must review such reports promptly." });
  const dutyDoc2 = mkDoc({
    id: uid(32),
    doc_no: "A.6.1.1.1.4.2.1",
    title: "Proposal Finalization",
    content: "The proposal is reviewed by the Operational Facilitator before being finalized.",
  });
  const dutyDoc3 = mkDoc({
    id: uid(33),
    doc_no: "A.1.6.6.2",
    title: "Universal GovOps Duties",
    content: "GovOps must document all decisions made during the review.",
  });
  const dutyDoc4 = mkDoc({
    id: uid(34),
    doc_no: "A.1.6.8.1",
    title: "General Facilitator Duties",
    content: "The Facilitator must act swiftly to resolve any ambiguity.",
  });
  const dutyDoc5 = mkDoc({
    id: uid(35),
    doc_no: "A.1.14.4.6",
    title: "Supervision Duties",
    content: "Executor Agents supervise other Agents and carry out routine operational tasks.",
  });

  // org-prose (2x): resolved prime_foundation_of, resolved provides_services_to,
  // and an unresolved pair (Keel doesn't exist in this corpus).
  const orgDoc1 = mkDoc({
    id: uid(36),
    doc_no: "A.6.1.1.1.2.1.1.3.1.1.4",
    title: "Foundation",
    content: "The Spark Foundation is the Prime Foundation associated with Spark. Its mandate is to support the development, growth, and adoption of Spark.",
  });
  const orgDoc2 = mkDoc({
    id: uid(37),
    doc_no: "A.6.1.1.1.2.1.1.3.1.1.5",
    title: "Development Company",
    content: 'Phoenix Labs is a development company that provides services to the Spark Foundation. Phoenix Labs is a "Nested Contributor".',
  });
  const orgDoc3 = mkDoc({
    id: uid(38),
    doc_no: "A.6.1.1.3.2.1.1.3.1.1.4",
    title: "Foundation",
    content: "The Keel Foundation is the Prime Foundation associated with Keel. Its mandate is to support Keel.",
  });

  // Pattern 14: Instance (Active tier, Spark/Distribution Reward) + Invocation
  // (In Progress tier, Grove/Integration Boost) + per-agent Primitive entities.
  const currentPrimitivesDoc = mkDoc({
    id: "203b8c79-c7cf-4fcc-94e3-5bf42f791619",
    doc_no: "A.2.2.3",
    title: "Current Primitives",
    content: "- Genesis\n    - Distribution Reward Primitive\n- Operational\n    - Agent Token Primitive",
  });

  const primRootDR = mkDoc({
    id: uid(40),
    doc_no: "A.6.1.1.1.2.5.1",
    title: "Distribution Reward Primitive",
    content: "The documents herein contain all data and specifications for Spark’s instances of the Distribution Reward Primitive.",
  });
  const statusDocDR = mkDoc({ id: uid(41), doc_no: "A.6.1.1.1.2.5.1.1.1", title: "Global Activation Status", content: "`Active`" });
  const activeInstancesTier = mkDoc({
    id: uid(42),
    doc_no: "A.6.1.1.1.2.5.1.2",
    title: "Active Instances",
    content: "The documents herein contain the active instances of the Distribution Reward Primitive.",
  });
  const icdDR = mkDoc({
    id: uid(43),
    doc_no: "A.6.1.1.1.2.5.1.2.1",
    title: "SparkLend Instance Configuration Document",
    content: "This is the Instance Configuration Document for Spark's SparkLend instance of the Distribution Reward Primitive.",
  });
  const paramsDocDR = mkDoc({ id: uid(44), doc_no: "A.6.1.1.1.2.5.1.2.1.1", title: "Parameters", content: "The documents herein define the parameters of this Instance." });
  const rewardCodeLeaf = mkDoc({ id: uid(45), doc_no: "A.6.1.1.1.2.5.1.2.1.1.1", title: "Reward Code", content: "`128`." });
  const customParamsLeaf = mkDoc({
    id: uid(46),
    doc_no: "A.6.1.1.1.2.5.1.2.1.1.2",
    title: "Custom Instance Parameters",
    content: "The documents herein define the custom parameters of the SparkLend Instance of the Distribution Reward Primitive.",
  });
  const miscLeaf = mkDoc({ id: uid(47), doc_no: "A.6.1.1.1.2.5.1.2.1.1.3", title: "Data Repository Location", content: "`ipfs://QmExampleHash`." });

  const primRootIB = mkDoc({
    id: uid(50),
    doc_no: "A.6.1.1.2.2.5.2",
    title: "Integration Boost Primitive",
    content: "The documents herein contain all data and specifications for Grove's instances of the Integration Boost Primitive.",
  });
  const inProgressTier = mkDoc({
    id: uid(51),
    doc_no: "A.6.1.1.2.2.5.2.4",
    title: "In Progress Invocations",
    content: "The documents herein contain the in-progress invocations of the Integration Boost Primitive.",
  });
  const icdIB = mkDoc({
    id: uid(52),
    doc_no: "A.6.1.1.2.2.5.2.4.1",
    title: "Aave Integration Boost Instance Configuration Document",
    content: "This is the Instance Configuration Document for Grove's in-progress Aave Integration Boost invocation.",
  });
  const invocationStatusDoc = mkDoc({ id: uid(53), doc_no: "A.6.1.1.2.2.5.2.4.1.1", title: "Invocation Status", content: "`Pending`." });
  const paramsDocIB = mkDoc({ id: uid(54), doc_no: "A.6.1.1.2.2.5.2.4.1.2", title: "Parameters", content: "The documents herein define the parameters of this Invocation." });
  const partnerNameLeaf = mkDoc({
    id: uid(55),
    doc_no: "A.6.1.1.2.2.5.2.4.1.2.1",
    title: "Integration Partner Name",
    content: "The partner for the Aave Integration Boost is Aave.",
  });

  const allDocs: AtlasNode[] = [
    sparkDoc, groveDoc,
    ozoneDoc, coreExec1Doc,
    ozoneFacDoc, ozoneGovDoc, core1FacDoc, core1GovDoc,
    opExecParamDoc, coreExecParamDoc,
    accordDoc, skyPartyDoc, sparkPartyDoc, moonbowPartyDoc, ozonePartyDoc,
    grantDoc1, grantDoc2, grantDoc3,
    aeaDoc, roleDefDoc, bindingDoc, synomeBindingDoc,
    spellTeamDoc, ergDoc, alignedDelegatesDoc, rankedL1Doc, rankedL2Doc,
    adc1, adc2, adc3, adc4, adc5, adc6,
    stepDoc1, stepDoc2,
    dutyDoc1, dutyDoc2, dutyDoc3, dutyDoc4, dutyDoc5,
    orgDoc1, orgDoc2, orgDoc3,
    currentPrimitivesDoc,
    primRootDR, statusDocDR, activeInstancesTier, icdDR, paramsDocDR, rewardCodeLeaf, customParamsLeaf, miscLeaf,
    primRootIB, inProgressTier, icdIB, invocationStatusDoc, paramsDocIB, partnerNameLeaf,
  ];

  const docById = new Map(allDocs.map((d) => [d.id, d]));
  const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));

  const addressesRaw = {
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1": { label: "BLUE", chain: "ethereum", roles: ["delegate"] },
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2": { label: "Redline Facilitation Group", chain: "ethereum" },
    "0xcccccccccccccccccccccccccccccccccccccc3": {
      label: "Proxy Example",
      chain: "ethereum",
      implementation: "0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD4",
    },
  };

  return { allDocs, docById, docByDocNo, addressesRaw };
}

describe("extractEntities — realistic corpus", () => {
  silence();
  const { allDocs, docById, docByDocNo, addressesRaw } = buildCorpus();
  const ctx = extractEntities(allDocs, docById, docByDocNo, addressesRaw);
  const e = (slug: string) => ctx.entityMap.get(slug);

  it("bootstraps Sky Core and Sky Governance", () => {
    expect(e("sky-core")).toMatchObject({ name: "Sky Core", entity_type: "operational_party" });
    expect(e("sky-governance")).toMatchObject({ name: "Sky Governance", entity_type: "governance_body" });
  });

  it("extracts Prime Agents keyed on doc_no A.6.1.1.X", () => {
    expect(e("spark")).toMatchObject({ entity_type: "agent", subtype: "prime" });
    expect(e("grove")).toMatchObject({ entity_type: "agent", subtype: "prime" });
  });

  it("extracts Executor Agents, stripping the operational prefix but not the core number", () => {
    expect(e("ozone")).toMatchObject({ name: "Ozone", entity_type: "agent", subtype: "operational_executor" });
    expect(e("core-council-executor-agent-1")).toMatchObject({
      name: "Core Council Executor Agent 1",
      subtype: "core_executor",
    });
  });

  it("extracts Facilitator and GovOps org names from assignment sentences (Pattern 5)", () => {
    expect(e("redline-facilitation-group")).toMatchObject({ entity_type: "facilitator_org" });
    expect(e("jansky")).toMatchObject({ entity_type: "facilitator_org" });
    expect(e("soter-labs")).toMatchObject({ entity_type: "govops_org" });
  });

  it("dedupes a Responsible Party direct-name declaration against an existing entity (A.1.6.1.5)", () => {
    expect(e("redline-facilitation-group")?.entity_type).toBe("facilitator_org");
  });

  it("does not create an entity for a role-only RP declaration (A.1.1.3.1 'Core Facilitator')", () => {
    expect(e("core-facilitator")).toBeUndefined();
  });

  it("does not create an entity for a descriptive RP phrase (A.2.7.1.1.1.1.4)", () => {
    expect(e("entity-to-which-the-registration-pertains")).toBeUndefined();
  });

  it("extracts ERG members, skipping a name that's already an entity (Pattern 7)", () => {
    expect(e("chronicle-labs")).toMatchObject({ entity_type: "ecosystem_actor" });
    expect(e("phoenix-labs")?.entity_type).toBe("development_company");
  });

  it("creates a delegate_org from addresses.json when roles includes 'delegate' (1h)", () => {
    expect(e("blue")).toMatchObject({ name: "BLUE", entity_type: "delegate_org" });
  });

  it("extracts Aligned Delegates via the bullet-list path and dedupes an address-originated entity (1i)", () => {
    expect(ctx.alignedDelegateNames).toEqual(["BLUE", "Cloaky"]);
    expect(e("cloaky")).toMatchObject({ entity_type: "delegate_org" });
    expect(e("blue")?.entity_type).toBe("delegate_org");
  });

  it("extracts Ranked Delegates for both levels, tagging via rankedDelegatesByLevel (1j)", () => {
    expect(ctx.rankedDelegatesByLevel.get(1)?.map((x: { name: string }) => x.name)).toEqual(["BLUE", "Cloaky"]);
    expect(ctx.rankedDelegatesByLevel.get(2)?.map((x: { name: string }) => x.name)).toEqual(["Bonapublica"]);
    expect(e("bonapublica")).toMatchObject({ entity_type: "delegate_org" });
  });

  it("walks A.1.7.1 role definitions to their .2 binding doc and extracts the holder (Pattern 11)", () => {
    expect(e("ba-labs")).toMatchObject({ entity_type: "ecosystem_actor" });
    expect(ctx.roleBindings.some((b: { roleSlug: string }) => b.roleSlug === "core_council_risk_advisor")).toBe(true);
  });

  it("finds a 'Designated ...' binding doc outside the A.1.7.1 walk (1k1, e.g. Synome Editor)", () => {
    expect(e("archon-tech")).toMatchObject({ entity_type: "ecosystem_actor" });
    expect(ctx.roleBindings.some((b: { roleSlug: string }) => b.roleSlug === "synome_editor")).toBe(true);
  });

  it("extracts Spell Team members from the team-list sentence (1k2)", () => {
    expect(e("dewiz")).toBeDefined();
    expect(e("sidestream")).toBeDefined();
    expect(ctx.roleBindings.filter((b: { roleSlug: string }) => b.roleSlug === "spell_team_member")).toHaveLength(2);
  });

  it("extracts grant recipients across all three bullet shapes ('*', '-', bare)", () => {
    expect(e("sky-frontier-foundation")).toMatchObject({ entity_type: "foundation" });
    expect(e("vertex-labs")).toMatchObject({ entity_type: "ecosystem_actor" });
    expect(e("sky-fortification-foundation")).toMatchObject({ entity_type: "foundation" });
  });

  it("resolves a multi-member composite party, splitting foundation vs dev-company by name shape (Pattern 12)", () => {
    expect(e("spark-party")).toMatchObject({ name: "Spark", entity_type: "composite_party" });
    expect(e("spark-foundation")).toMatchObject({ entity_type: "foundation" });
    expect(e("phoenix-labs")).toMatchObject({ entity_type: "development_company" });
  });

  it("short-circuits the Sky party onto the sky-core bootstrap (no 'sky-party' composite)", () => {
    expect(e("sky-party")).toBeUndefined();
  });

  it("models an atomic party ('is the entity owning...') as composite_party with no members resolved", () => {
    expect(e("moonbow-party")).toMatchObject({ entity_type: "composite_party" });
  });

  it("resolves a single-member party whose member strips to an existing agent slug (Ozone)", () => {
    expect(e("ozone-party")).toMatchObject({ entity_type: "composite_party" });
  });

  it("creates an Instance entity for an Active-tier ICD, with params tuple-keyed by source doc (Pattern 14)", () => {
    const inst = e("spark-distribution-reward-sparklend");
    expect(inst).toMatchObject({ name: "SparkLend", entity_type: "instance", subtype: "distribution-reward" });
    const meta = JSON.parse(inst!.meta);
    expect(meta.status).toBe("Active");
    expect(meta.params["Reward Code"][0]).toBe("128");
    expect(meta.params["Custom Instance Parameters"]).toBeUndefined();
    expect(meta.params["Data Repository Location"][0]).toBe("ipfs://QmExampleHash");
  });

  it("creates an Invocation entity for an In-Progress-tier ICD, classified via ancestor tier title", () => {
    const inv = e("grove-integration-boost-aave-integration-boost");
    expect(inv).toMatchObject({ name: "Aave Integration Boost", entity_type: "invocation", subtype: "integration-boost" });
    const meta = JSON.parse(inv!.meta);
    expect(meta.status).toBe("InProgress");
    expect(meta.params["Integration Partner Name"][0]).toBe("Aave");
  });

  it("creates a per-agent Primitive entity, known vs unknown per the Current Primitives registry", () => {
    const dr = e("spark-distribution-reward");
    expect(dr).toMatchObject({ entity_type: "primitive" });
    expect(JSON.parse(dr!.meta).is_unknown_primitive).toBeUndefined();
    expect(JSON.parse(dr!.meta).status).toBe("Active");

    const ib = e("grove-integration-boost");
    expect(ib).toMatchObject({ entity_type: "primitive" });
    expect(JSON.parse(ib!.meta).is_unknown_primitive).toBe(true);
  });

  it("returns entityByDocId covering every doc-defined entity for edge-phase lookups", () => {
    const spark = e("spark")!;
    expect(ctx.entityByDocId.get(spark.defining_doc_id)).toBe(spark);
  });
});

describe("extractEntities — Aligned Delegates prose fallback", () => {
  it("parses 'Aligned Delegates are X, Y, and Z.' when no bullet list is present", () => {
    silence();
    const doc = mkDoc({
      id: ALIGNED_DELEGATES_UUID,
      doc_no: "A.1.6.1.5.0.6.1",
      title: "Current Aligned Delegates",
      type: "Active Data",
      content: "The Aligned Delegates are BLUE, Cloaky, and Bonapublica.",
    });
    const docById = new Map([[doc.id, doc]]);
    const docByDocNo = new Map([[doc.doc_no, doc]]);
    const ctx = extractEntities([doc], docById, docByDocNo, {});
    expect(ctx.alignedDelegateNames).toEqual(["BLUE", "Cloaky", "Bonapublica"]);
    expect(ctx.entityMap.get("bonapublica")).toMatchObject({ entity_type: "delegate_org" });
  });
});

describe("extractEntities — sparse corpus (missing registry docs)", () => {
  it("warns for every UUID-anchored registry doc that isn't found, without throwing", () => {
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m) => void warns.push(String(m)));
    const doc = mkDoc({ id: "only-doc", doc_no: "A.6.1.1.1", title: "Spark" });
    const docById = new Map([[doc.id, doc]]);
    const docByDocNo = new Map([[doc.doc_no, doc]]);
    const ctx = extractEntities([doc], docById, docByDocNo, {});
    expect(ctx.entityMap.get("spark")).toMatchObject({ entity_type: "agent", subtype: "prime" });
    expect(warns.some((w) => w.includes(ERG_MEMBERSHIP_UUID))).toBe(true);
    expect(warns.some((w) => w.includes(ALIGNED_DELEGATES_UUID))).toBe(true);
    expect(warns.some((w) => w.includes(RANKED_DELEGATE_UUIDS.get(1)))).toBe(true);
    expect(warns.some((w) => w.includes(RANKED_DELEGATE_UUIDS.get(2)))).toBe(true);
    expect(warns.some((w) => w.includes(SPELL_TEAM_UUID))).toBe(true);
  });
});
