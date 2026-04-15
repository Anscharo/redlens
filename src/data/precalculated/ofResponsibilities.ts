export interface OFResponsibility {
  docNo: string;
  uuid: string;
  title: string;
  duty: string;
  category: 'universal' | 'root-edit' | 'artifact-edit' | 'active-data';
  agent?: string;   // single agent
  agents?: string[]; // multiple agents (collapsed display)
}

export const AGENTS = ['Spark', 'Grove', 'Keel', 'Skybase', 'Obex', 'Pattern', 'Launch Agent 6', 'Launch Agent 7'] as const;
export type Agent = typeof AGENTS[number];

export interface AgentMeta {
  executorAgent: string;
  operationalFacilitator: string;
  operationalGovOps: string;
  executorDocNo: string;
  facilitatorDocNo: string;
}

export const AGENT_META: Record<string, AgentMeta> = {
  'Spark':          { executorAgent: 'Ozone',   operationalFacilitator: 'Redline Facilitation Group', operationalGovOps: 'Soter Labs', executorDocNo: 'A.6.1.2.2',   facilitatorDocNo: 'A.6.1.2.2.1' },
  'Grove':          { executorAgent: 'Amatsu',  operationalFacilitator: 'Endgame Edge',               operationalGovOps: 'Soter Labs', executorDocNo: 'A.6.1.2.1',   facilitatorDocNo: 'A.6.1.2.1.1' },
  'Keel':           { executorAgent: 'Amatsu',  operationalFacilitator: 'Endgame Edge',               operationalGovOps: 'Soter Labs', executorDocNo: 'A.6.1.2.1',   facilitatorDocNo: 'A.6.1.2.1.1' },
  'Skybase':        { executorAgent: 'Amatsu',  operationalFacilitator: 'Endgame Edge',               operationalGovOps: 'Soter Labs', executorDocNo: 'A.6.1.2.1',   facilitatorDocNo: 'A.6.1.2.1.1' },
  'Obex':           { executorAgent: 'Amatsu',  operationalFacilitator: 'Endgame Edge',               operationalGovOps: 'Soter Labs', executorDocNo: 'A.6.1.2.1',   facilitatorDocNo: 'A.6.1.2.1.1' },
  'Pattern':        { executorAgent: 'Amatsu',  operationalFacilitator: 'Endgame Edge',               operationalGovOps: 'Soter Labs', executorDocNo: 'A.6.1.2.1',   facilitatorDocNo: 'A.6.1.2.1.1' },
  'Launch Agent 6': { executorAgent: 'Amatsu',  operationalFacilitator: 'Endgame Edge',               operationalGovOps: 'Soter Labs', executorDocNo: 'A.6.1.2.1',   facilitatorDocNo: 'A.6.1.2.1.1' },
  'Launch Agent 7': { executorAgent: 'Amatsu',  operationalFacilitator: 'Endgame Edge',               operationalGovOps: 'Soter Labs', executorDocNo: 'A.6.1.2.1',   facilitatorDocNo: 'A.6.1.2.1.1' },
};

// Note: Skybase, Obex, Pattern, Launch Agents 6 & 7 executor assignment to Amatsu is
// inferred from consistent "Operational Facilitator Endgame Edge" in multisig signers.
// Grove and Keel are confirmed via A.6.1.1.2.2.6.1.2.1.2.2.4.3 and A.6.1.1.3.2.6.1.2.1.2.2.3.3.
// Spark → Ozone inferred from "Spark Operational Facilitator" role in A.6.1.1.1.3.7.2.7.3.

export const OF_RESPONSIBILITIES: OFResponsibility[] = [
  // Universal — apply to all Operational Facilitators
  { docNo: 'A.1.6.1',             uuid: '4354cb31-d2e3-433d-bbf8-5db2020acf48', title: 'Operational Executor Facilitator',                   duty: 'Interpret the Atlas and Artifacts on behalf of the Agent; enter formal agreement with Agent', category: 'universal' },
  { docNo: 'A.1.6.3',             uuid: '014feb92-49dc-4117-911f-a6ec14451b30', title: 'Facilitators Must Maintain High Level Of Operational Security', duty: 'Maintain best-practice privacy, cybersecurity, and physical resilience; regularly review protocols', category: 'universal' },
  { docNo: 'A.1.6.8',             uuid: '3f056c21-92de-4177-8c81-f8ba83a880ca', title: 'Prohibition On Engaging With Counterparties',          duty: 'No counterparty engagement except to set up governance processes; document all such interactions', category: 'universal' },
  { docNo: 'A.1.6.9',             uuid: 'f88d568e-bf5b-46f4-9adf-5299854de709', title: 'Governance Process And Interaction Documentation',      duty: 'Document all operational/governance processes and all stakeholder interactions', category: 'universal' },
  { docNo: 'A.1.12.1.3.1',        uuid: 'ecce1a73-dac3-4fe5-a9d6-8b445bbc591a', title: 'Direct Edit',                                          duty: 'For Active Data in an Agent Artifact: confirm Responsible Party authority, then carry out the edit', category: 'universal' },
  { docNo: 'A.1.9.2.4.13.5',      uuid: '193f43fc-f26f-4fa0-b3cf-f50c68177906', title: 'Facilitator Updates Atlas To Reflect Spell Outcome',    duty: 'After Spell execution, carry out all required follow-up edits to the affected Agent Artifact', category: 'universal' },
  { docNo: 'A.2.2.5.2.1.2.2',     uuid: '823cad54-4438-4ec3-9e13-d2624795fabd', title: 'Root Edit Primitive Review By Operational Facilitator', duty: 'Review Root Edit Proposals for Atlas alignment AND Agent-specific Root Edit Primitive requirements (eligible proposers, form, timing)', category: 'universal' },
  { docNo: 'A.2.2.9.1.1.3.3.1.3', uuid: 'aee1d848-eee8-4590-a596-1884efcb474a', title: 'Governance Process for Instance Modification',          duty: 'Review Capital & Operational Plan proposals for completeness and general alignment before token holder governance', category: 'universal' },

  // Per-agent — Root Edit review (one entry per agent, collapsed in UI)
  {
    docNo: 'A.6.1.1.x.2.2.2.2.1.2.1.3', uuid: '32bad904-ba90-4abb-9115-0b304a792521',
    title: 'Root Edit Proposal Review By Operational Facilitator',
    duty: 'Within 7 days of submission: review for Atlas alignment and Agent-specific Primitive requirements. If aligned, confirm operationalizability and respond on Forum. If misaligned, state reasoning and reject.',
    category: 'root-edit',
    agents: ['Spark', 'Grove', 'Keel', 'Skybase', 'Obex', 'Pattern', 'Launch Agent 6', 'Launch Agent 7'],
  },
  { docNo: 'A.6.1.1.1.2.2.2.2.1.2.1.4', uuid: 'b60cfc4e-4cc5-4040-9610-f2113980831b', title: 'Root Edit Token Holder Vote', duty: 'After alignment finding + SRC approval, trigger Snapshot poll for token holder vote', category: 'root-edit', agent: 'Spark' },

  // Per-agent — Artifact Edit Restrictions enforcement
  { docNo: 'A.6.1.1.2.2.2.2.1.2.1.6', uuid: 'd3c68da3-81ff-4b73-a50c-1f9de5b6ff7f', title: 'Artifact Edit Restrictions', duty: 'Enforce that Artifact edits cannot violate Sky Core Atlas or Sky Primitives; review all Artifact Edit Proposals', category: 'artifact-edit', agent: 'Grove' },
  { docNo: 'A.6.1.1.4.2.2.2.2.1.2.1.6', uuid: 'f3e8ecec-cb08-4682-9218-d13f567fc00e', title: 'Artifact Edit Restrictions', duty: 'Enforce that Artifact edits cannot violate Sky Core Atlas or Sky Primitives; review all Artifact Edit Proposals', category: 'artifact-edit', agent: 'Skybase' },
  { docNo: 'A.6.1.1.6.2.2.2.2.1.2.1.6', uuid: '4137d6f6-d330-4953-99e7-b17f2fb8ac55', title: 'Artifact Edit Restrictions', duty: 'Enforce that Artifact edits cannot violate Sky Core Atlas or Sky Primitives; review all Artifact Edit Proposals', category: 'artifact-edit', agent: 'Pattern' },

  // Per-agent — Active Data maintenance (OF is Responsible Party)
  { docNo: 'A.6.1.1.1.3.1.3.8.2', uuid: '7802904e-51fd-4308-ae9f-5f4595eca3e5', title: 'Updating List of Delegates',     duty: 'Maintain Delegate list; triggered by Spark Foundation onboarding/offboarding/renewal notices', category: 'active-data', agent: 'Spark' },
  { docNo: 'A.6.1.1.1.3.1.4.11.1', uuid: '066783d5-c191-4db7-a38a-5370a75944ee', title: 'Updating SRC Membership Registry', duty: 'Maintain SRC membership list; Direct Edit process', category: 'active-data', agent: 'Spark' },
];

export const CATEGORY_LABELS: Record<OFResponsibility['category'], string> = {
  'universal':     'Universal — all Operational Facilitators',
  'root-edit':     'Root Edit Proposal Review (7-day deadline, per agent)',
  'artifact-edit': 'Artifact Edit Restrictions Enforcement (per agent)',
  'active-data':   'Active Data Maintenance — OF as Responsible Party (per agent)',
};
