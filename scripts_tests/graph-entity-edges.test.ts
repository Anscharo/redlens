// Unit tests for Phase 2 entity/address edge extraction
// (scripts/lib/graph-entity-edges.mjs). Complements
// graph-entity-edges-drift.test.ts (empty-corpus drift signals): this corpus
// is realistic and non-empty, exercising the actual extraction patterns
// documented in .claude/skills/parse-atlas/SKILL.md, prioritized by real
// build frequency (responsible_party_for, process_step_responsible_party_for,
// comprises, ecosystem_accord, erg_member_for, prime_agent_for,
// operational_executor_agent_for, proxies_to). Doc_nos are cited in comments
// per repo convention.

import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractEntities } from "../scripts/lib/graph-entities.mjs";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractEntityEdges } from "../scripts/lib/graph-entity-edges.mjs";
import {
  ERG_MEMBERSHIP_UUID,
  ALIGNED_DELEGATES_UUID,
  RANKED_DELEGATE_UUIDS,
  SPELL_TEAM_UUID,
  ACTIVE_ECOSYSTEM_ACTORS_UUID,
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

// Same corpus shape as graph-entities.test.ts (duplicated intentionally —
// each test file is self-contained per repo test convention).
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

  const ergDoc = mkDoc({
    id: ERG_MEMBERSHIP_UUID,
    doc_no: "A.1.9.1.2.2.0.6.1",
    title: "Emergency Response Group Current Membership",
    type: "Active Data",
    content: "The members of the Emergency Response Group are:\n\n- Phoenix Labs\n- Chronicle Labs",
  });

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

type Edge = {
  fromId: string;
  fromType: string;
  toId: string;
  toType: string;
  edgeType: string;
  sourceDocNos: string[];
  meta: string | null;
};

describe("extractEntityEdges — realistic corpus", () => {
  silence();
  const { allDocs, docById, docByDocNo, addressesRaw } = buildCorpus();
  const ctx = extractEntities(allDocs, docById, docByDocNo, addressesRaw);
  const edges: Edge[] = extractEntityEdges(allDocs, docById, docByDocNo, ctx, addressesRaw);
  const e = (slug: string) => ctx.entityMap.get(slug);
  const byType = (t: string) => edges.filter((ed) => ed.edgeType === t);

  it("emits prime_agent_for from every Prime Agent to Sky Core (Pattern 1)", () => {
    const spark = e("spark")!;
    const skyCore = e("sky-core")!;
    const hits = byType("prime_agent_for");
    expect(hits).toContainEqual(
      expect.objectContaining({ fromId: spark.id, toId: skyCore.id, sourceDocNos: ["A.6.1.1.1"] }),
    );
    expect(hits).toHaveLength(2); // Spark + Grove
  });

  it("emits operational/core_executor_agent_for by resolving the UUID citation and walking parentId to the Prime Agent (Pattern 3)", () => {
    const ozone = e("ozone")!;
    const coreExec = e("core-council-executor-agent-1")!;
    const spark = e("spark")!;
    expect(byType("operational_executor_agent_for")).toContainEqual(
      expect.objectContaining({ fromId: ozone.id, toId: spark.id }),
    );
    expect(byType("core_executor_agent_for")).toContainEqual(
      expect.objectContaining({ fromId: coreExec.id, toId: spark.id }),
    );
    // Best-effort accord match: Spark's party doc mentions "Spark Prime Agent".
    const opEdge = byType("operational_executor_agent_for")[0];
    expect(opEdge.sourceDocNos).toContain("A.2.8.2.2");
  });

  it("emits operational/core_facilitator_for and operational/core_govops_for (Pattern 5)", () => {
    const redline = e("redline-facilitation-group")!;
    const jansky = e("jansky")!;
    const soter = e("soter-labs")!;
    const ozone = e("ozone")!;
    const coreExec = e("core-council-executor-agent-1")!;
    expect(byType("operational_facilitator_for")).toContainEqual(expect.objectContaining({ fromId: redline.id, toId: ozone.id }));
    expect(byType("core_facilitator_for")).toContainEqual(expect.objectContaining({ fromId: jansky.id, toId: coreExec.id }));
    expect(byType("operational_govops_for")).toContainEqual(expect.objectContaining({ fromId: soter.id, toId: ozone.id }));
    expect(byType("core_govops_for")).toContainEqual(expect.objectContaining({ fromId: soter.id, toId: coreExec.id }));
  });

  it("emits aligned_delegate_for and ranked_delegate_for with meta.level", () => {
    const blue = e("blue")!;
    const skyGov = e("sky-governance")!;
    expect(byType("aligned_delegate_for")).toContainEqual(expect.objectContaining({ fromId: blue.id, toId: skyGov.id }));
    expect(byType("aligned_delegate_for")).toHaveLength(2);
    const l1 = byType("ranked_delegate_for").find((ed) => ed.fromId === blue.id);
    expect(JSON.parse(l1!.meta!)).toEqual({ level: 1 });
    const l2 = byType("ranked_delegate_for").find((ed) => ed.fromId === e("bonapublica")!.id);
    expect(JSON.parse(l2!.meta!)).toEqual({ level: 2 });
    expect(byType("ranked_delegate_for")).toHaveLength(3);
  });

  it("emits holds_role_for for A.1.7.1 bindings, the 1k1 Synome binding, and Spell Team members", () => {
    const baLabs = e("ba-labs")!;
    const archonTech = e("archon-tech")!;
    const dewiz = e("dewiz")!;
    expect(byType("holds_role_for")).toContainEqual(
      expect.objectContaining({ fromId: baLabs.id, meta: expect.stringContaining("core_council_risk_advisor") }),
    );
    expect(byType("holds_role_for")).toContainEqual(
      expect.objectContaining({ fromId: archonTech.id, meta: expect.stringContaining("synome_editor") }),
    );
    expect(byType("holds_role_for")).toContainEqual(
      expect.objectContaining({ fromId: dewiz.id, meta: expect.stringContaining("spell_team_member") }),
    );
  });

  it("emits ecosystem_accord to every party (composite or Sky Core short-circuit), including atomic Moonbow (Pattern 4/12)", () => {
    const skyCore = e("sky-core")!;
    const sparkParty = e("spark-party")!;
    const moonbowParty = e("moonbow-party")!;
    const hits = byType("ecosystem_accord");
    expect(hits).toContainEqual(expect.objectContaining({ toId: skyCore.id, sourceDocNos: ["A.2.8.2.2"] }));
    expect(hits).toContainEqual(expect.objectContaining({ toId: sparkParty.id }));
    expect(hits).toContainEqual(expect.objectContaining({ toId: moonbowParty.id }));
    expect(hits).toHaveLength(4); // Sky, Spark, Moonbow, Ozone
  });

  it("emits comprises for every resolved member, skipping the Sky short-circuit and the atomic Moonbow party", () => {
    const sparkParty = e("spark-party")!;
    const spark = e("spark")!;
    const sparkFoundation = e("spark-foundation")!;
    const phoenixLabs = e("phoenix-labs")!;
    const ozoneParty = e("ozone-party")!;
    const ozone = e("ozone")!;
    const hits = byType("comprises");
    expect(hits).toContainEqual(expect.objectContaining({ fromId: sparkParty.id, toId: spark.id }));
    expect(hits).toContainEqual(expect.objectContaining({ fromId: sparkParty.id, toId: sparkFoundation.id }));
    expect(hits).toContainEqual(expect.objectContaining({ fromId: sparkParty.id, toId: phoenixLabs.id }));
    expect(hits).toContainEqual(expect.objectContaining({ fromId: ozoneParty.id, toId: ozone.id }));
    expect(hits.some((ed) => ed.toId === e("sky-core")!.id)).toBe(false);
    expect(hits).toHaveLength(4);
  });

  it("emits erg_member_for for every resolvable ERG member", () => {
    const ergDocEnt = docById.get(ERG_MEMBERSHIP_UUID)!;
    expect(byType("erg_member_for")).toContainEqual(
      expect.objectContaining({ fromId: e("chronicle-labs")!.id, toId: ergDocEnt.id }),
    );
    expect(byType("erg_member_for")).toHaveLength(2);
  });

  it("resolves responsible_party_for via all three paths: direct, chain, role-binding — and counts unresolved", () => {
    const hits = byType("responsible_party_for");
    // A.1.6.1.5 — direct name match.
    const direct = hits.find((ed) => ed.sourceDocNos[0] === "A.1.6.1.5");
    expect(direct?.fromId).toBe(e("redline-facilitation-group")!.id);
    expect(JSON.parse(direct!.meta!).resolution).toBe("direct");
    // A.1.1.3.1 — chain resolution, no prime-agent context (bare Core Facilitator).
    const chainBare = hits.find((ed) => ed.sourceDocNos[0] === "A.1.1.3.1");
    expect(chainBare?.fromId).toBe(e("jansky")!.id);
    expect(JSON.parse(chainBare!.meta!).resolution).toBe("chain");
    // A.6.1.1.1.3.9.1 — chain resolution WITH prime-agent context (Spark → Ozone → Soter Labs).
    const chainAgent = hits.find((ed) => ed.sourceDocNos[0] === "A.6.1.1.1.3.9.1");
    expect(chainAgent?.fromId).toBe(e("soter-labs")!.id);
    expect(JSON.parse(chainAgent!.meta!).resolution).toBe("chain");
    // A.1.5.10.2 — role-binding resolution (Core Council Risk Advisor → BA Labs).
    const role = hits.find((ed) => ed.sourceDocNos[0] === "A.1.5.10.2");
    expect(role?.fromId).toBe(e("ba-labs")!.id);
    expect(JSON.parse(role!.meta!).resolution).toBe("role");
    // A.1.9.1.2.2 (no RP) and A.2.7.1.1.1.1.4 (descriptive RP) both unresolved.
    expect(hits.some((ed) => ed.sourceDocNos[0] === "A.1.9.1.2.2")).toBe(false);
    expect(hits.some((ed) => ed.sourceDocNos[0] === "A.2.7.1.1.1.1.4")).toBe(false);
  });

  it("resolves process_step_responsible_party_for across multiple declarations, automation brackets, and dedupes repeats", () => {
    const hits = byType("process_step_responsible_party_for").filter((ed) => ed.sourceDocNos[0] === "A.2.2.9.1.2.3.1.3");
    expect(hits).toHaveLength(2); // Redline (direct) + Soter Labs (chain, automated) — repeat dedupes.
    const redlineEdge = hits.find((ed) => ed.fromId === e("redline-facilitation-group")!.id)!;
    expect(JSON.parse(redlineEdge.meta!).automated).toBe(false);
    const soterEdge = hits.find((ed) => ed.fromId === e("soter-labs")!.id)!;
    expect(JSON.parse(soterEdge.meta!).automated).toBe(true);
    // A.2.2.9.1.2.3.2.3 — unresolved name never emits an edge.
    expect(byType("process_step_responsible_party_for").some((ed) => ed.sourceDocNos[0] === "A.2.2.9.1.2.3.2.3")).toBe(false);
  });

  it("emits duty_for across govops/facilitator/executor with title/active/passive/org resolution and bare-label fan-out", () => {
    const soter = e("soter-labs")!;
    const redline = e("redline-facilitation-group")!;
    const jansky = e("jansky")!;
    const ozone = e("ozone")!;
    const coreExec = e("core-council-executor-agent-1")!;
    const hits = byType("duty_for");
    // Core GovOps active match, resolved to the Core GovOps holder.
    expect(hits).toContainEqual(expect.objectContaining({ fromId: soter.id, toId: dutyDocIdFor("A.3.5.1", allDocs) }));
    // Facilitator passive match in an agent-artifact context (execId branch).
    expect(hits.some((ed) => ed.fromId === redline.id && JSON.parse(ed.meta!).match === "passive")).toBe(true);
    // Facilitator bare/universal duty fans out to BOTH the op and core holder.
    const bareFacilitator = hits.filter((ed) => JSON.parse(ed.meta!).role_declared === "Facilitator");
    expect(bareFacilitator.map((ed) => ed.fromId).sort()).toEqual([jansky.id, redline.id].sort());
    // Executor bare duty fans out to both the operational and core executor.
    const executorDuty = hits.filter((ed) => JSON.parse(ed.meta!).role_declared === "Executor Agent");
    expect(executorDuty.map((ed) => ed.fromId).sort()).toEqual([coreExec.id, ozone.id].sort());
  });

  it("emits defines_entity for every entity whose defining doc is present in the corpus", () => {
    const spark = e("spark")!;
    expect(byType("defines_entity")).toContainEqual(
      expect.objectContaining({ fromId: spark.defining_doc_id, toId: spark.id }),
    );
    // Bootstrap entities have no in-corpus defining doc — never emitted.
    expect(byType("defines_entity").some((ed) => ed.toId === e("sky-core")!.id)).toBe(false);
  });

  it("emits has_address for a delegate created from addresses.json and for an entity matched by label slug", () => {
    const blue = e("blue")!;
    const redline = e("redline-facilitation-group")!;
    const hits = byType("has_address");
    expect(hits).toContainEqual(
      expect.objectContaining({ fromId: blue.id, toId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1:ethereum" }),
    );
    expect(hits).toContainEqual(
      expect.objectContaining({ fromId: redline.id, toId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2:ethereum" }),
    );
    expect(hits).toHaveLength(2);
  });

  it("emits mentions for addressRefs, resolving chain from addressesRaw or falling back to ethereum", () => {
    const hits = byType("mentions");
    expect(hits).toContainEqual(
      expect.objectContaining({ toId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1:ethereum" }),
    );
    // adc3's addressRef has no addressesRaw entry — falls back to "ethereum".
    expect(hits).toContainEqual(
      expect.objectContaining({ toId: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee5:ethereum" }),
    );
  });

  it("emits prime_foundation_of and provides_services_to only when both endpoints resolve", () => {
    const sparkFoundation = e("spark-foundation")!;
    const spark = e("spark")!;
    const phoenixLabs = e("phoenix-labs")!;
    expect(byType("prime_foundation_of")).toContainEqual(
      expect.objectContaining({ fromId: sparkFoundation.id, toId: spark.id }),
    );
    expect(byType("provides_services_to")).toContainEqual(
      expect.objectContaining({ fromId: phoenixLabs.id, toId: sparkFoundation.id }),
    );
    // Keel Foundation / Keel never resolve in this corpus — no edge, just a warning.
    expect(byType("prime_foundation_of")).toHaveLength(1);
  });

  it("emits proxies_to for an address with an implementation field, independent of entity resolution", () => {
    expect(byType("proxies_to")).toContainEqual(
      expect.objectContaining({
        fromId: "0xcccccccccccccccccccccccccccccccccccccc3:ethereum",
        toId: "0xddddddddddddddddddddddddddddddddddddddd4:ethereum",
      }),
    );
  });
});

// Small helper: locate a fixture doc's id by doc_no, for assertions that only
// know the doc_no (mirrors how source_doc_nos are used for provenance).
function dutyDocIdFor(docNo: string, allDocs: AtlasNode[]): string {
  return allDocs.find((d) => d.doc_no === docNo)!.id;
}

describe("extractEntityEdges — sparse corpus (missing registry docs)", () => {
  it("still emits prime_agent_for + defines_entity and warns without throwing", () => {
    silence();
    const doc = mkDoc({ id: "only-doc", doc_no: "A.6.1.1.1", title: "Spark" });
    const docById = new Map([[doc.id, doc]]);
    const docByDocNo = new Map([[doc.doc_no, doc]]);
    const ctx = extractEntities([doc], docById, docByDocNo, {});
    const edges: Edge[] = extractEntityEdges([doc], docById, docByDocNo, ctx, {});
    expect(edges.some((ed) => ed.edgeType === "prime_agent_for")).toBe(true);
    expect(edges.some((ed) => ed.edgeType === "defines_entity")).toBe(true);
  });
});
