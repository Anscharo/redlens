export interface ActiveDataEntry {
  controllerDocNo: string;
  controllerUuid: string;
  title: string;
  responsibleParty: string;
  process: 'Direct Edit' | 'Alignment Conserver Changes';
  agent: string | null;  // null = Sky Core Atlas
  note?: string;
}

export const ACTIVE_DATA_INDEX: ActiveDataEntry[] = [
  // Sky Core Atlas
  { controllerDocNo: 'A.1.1.3.1',            controllerUuid: 'c3c7c96c-d756-4e54-a5c5-79b5970394e0', title: 'List of Atlas Interpretations',              responsibleParty: 'Core Facilitator',          process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.1.4.10.2',           controllerUuid: '15def023-af2e-4a27-92c4-6fab7b6f02f6', title: 'Derecognized Alignment Conservers',           responsibleParty: 'Core Facilitator',          process: 'Alignment Conserver Changes', agent: null },
  { controllerDocNo: 'A.1.5.1.5',            controllerUuid: '79e4e209-2925-4074-95f5-28544117c680', title: 'Current Aligned Delegates',                  responsibleParty: 'Core Facilitator',          process: 'Alignment Conserver Changes', agent: null },
  { controllerDocNo: 'A.1.5.6.1.3',          controllerUuid: '32862df8-a277-48a3-bb0f-40ed1e051dfd', title: 'Aligned Delegate Breach Registry',           responsibleParty: 'Core Facilitator',          process: 'Alignment Conserver Changes', agent: null },
  { controllerDocNo: 'A.1.8.1.2.2',          controllerUuid: '6ad02ee6-bd7a-4557-a768-178656037162', title: 'Emergency Response Group Membership',         responsibleParty: 'Core GovOps',               process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.1.9.2.3.2.2.1.5',   controllerUuid: 'a2777f65-6340-46c2-b0f3-95a63fef2f8a', title: 'Prime Spell Security Incident Registry',     responsibleParty: 'Core Facilitator',          process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.2.2.8.1.2.1.1.2.1.1', controllerUuid: 'd251bbac-df0e-4aff-a26b-33d60e153e19', title: 'Integrator Program Applications',           responsibleParty: 'Viridian Advisors',         process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.2.2.8.1.2.1.4.6.1', controllerUuid: '32e27a27-7d1e-4acc-9b67-805eaedb7b97', title: 'Auxiliary Accounts',                         responsibleParty: 'Operational GovOps Soter Labs', process: 'Direct Edit',              agent: null },
  { controllerDocNo: 'A.2.2.8.1.2.1.6.1',   controllerUuid: '883f1b52-a6d2-417b-bb24-12917de83b53', title: 'Current Integrators',                        responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.2.2.8.1.2.1.6.2',   controllerUuid: '9a7f47ae-760f-44b5-9b5f-dd4fef86e1cc', title: 'Onboarding Integrators',                     responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.2.2.8.1.2.1.7.1',   controllerUuid: '2c0eb02c-144e-4326-b5ec-85805653f0b7', title: 'Sky Core Distribution Reward Reimbursement Amounts', responsibleParty: 'Core GovOps',        process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.2.2.8.2.2.1.5.1',   controllerUuid: '7ed013c9-f7ac-4459-8675-8bbd398d5133', title: 'Sky Core Integration Boost Reimbursement Amounts',   responsibleParty: 'Core GovOps',        process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.2.2.8.3.1.2.1',     controllerUuid: '65fc0b79-8827-403d-80ee-9f74a6be1069', title: 'Active Pioneer Primes',                      responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.2.2.9.1.1.1.1.2',   controllerUuid: '1c0410e4-fe36-4a01-8b82-8ea74f67fbec', title: 'Current Sky Direct Exposures',               responsibleParty: 'Core Facilitator',          process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.2.8.1.2',            controllerUuid: 'e6384df7-246b-4240-93e8-01bf903e072d', title: 'Ecosystem Accord Dispute Resolutions',       responsibleParty: 'Core Facilitator',          process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.2.9.1.1.1.2.3',     controllerUuid: 'ab894e9e-b423-404b-8488-3d0578bbde28', title: 'Resilience Fund Technical Committee Members', responsibleParty: 'Support Facilitators',      process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.2.9.1.1.2.6',       controllerUuid: '2e3f851c-6ee2-472a-aa4f-cf637ff1cd8a', title: 'Lawyer Registry (Approved Legal Counsels)',  responsibleParty: 'Support Facilitators',      process: 'Direct Edit',                 agent: null },
  { controllerDocNo: 'A.3.7.1.5.3',         controllerUuid: '9d418790-3081-43b4-a6f6-1c49ff5b4be8', title: 'Communication Channels & Media Assets',      responsibleParty: 'Core GovOps',               process: 'Direct Edit',                 agent: null },

  // Spark (A.6.1.1.1.x)
  { controllerDocNo: 'A.6.1.1.1.3.1.3.8.2', controllerUuid: '7802904e-51fd-4308-ae9f-5f4595eca3e5', title: 'List of Delegates',                          responsibleParty: 'Redline Facilitation Group', process: 'Direct Edit',                agent: 'Spark' },
  { controllerDocNo: 'A.6.1.1.1.3.1.4.11.1', controllerUuid: '066783d5-c191-4db7-a38a-5370a75944ee', title: 'SRC Membership Registry',                   responsibleParty: 'Redline Facilitation Group', process: 'Direct Edit',                agent: 'Spark' },
  { controllerDocNo: 'A.6.1.1.1.3.2.2.2.1.1', controllerUuid: '',                                   title: 'Special Pre-launch Token Reward Programs',   responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Spark' },
  { controllerDocNo: 'A.6.1.1.1.2.5.1.2.1.3.4', controllerUuid: '971d047b-4e7b-4545-9090-6d509e572aa0', title: 'Distribution Reward Payments — SparkLend', responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Spark' },
  { controllerDocNo: 'A.6.1.1.1.2.5.2.2.1', controllerUuid: 'c3ca980e-56a7-42fc-a3f2-76516fb42088', title: 'Integration Boost Payments — Aave (SLL)',    responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Spark' },

  // Keel (A.6.1.1.3.x)
  { controllerDocNo: 'A.6.1.1.3.2.5.2.2.1', controllerUuid: 'f02b9ea5-ceae-42dd-8ca0-9565f7148efb', title: 'Integration Boost Payments — Kamino',        responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Keel' },
  { controllerDocNo: 'A.6.1.1.3.2.5.2.2.2', controllerUuid: 'de885def-4e9c-4116-9a16-899f0d45340f', title: 'Integration Boost Payments — Drift',         responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Keel' },
  { controllerDocNo: 'A.6.1.1.3.2.5.2.2.3', controllerUuid: '5c116971-2a07-4074-9a41-422e18f5eaec', title: 'Integration Boost Payments — Save',          responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Keel' },
  { controllerDocNo: 'A.6.1.1.3.2.5.2.2.4', controllerUuid: 'b2077965-9350-4699-be85-847934f1d7b0', title: 'Integration Boost Payments — Lifinity',      responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Keel' },
  { controllerDocNo: 'A.6.1.1.3.2.5.2.3.1.3.4', controllerUuid: '61c17003-e1b0-46a8-8b67-0b120a0cdd5b', title: 'Integration Boost Payments — MarginFi',  responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Keel' },

  // Skybase (A.6.1.1.4.x)
  { controllerDocNo: 'A.6.1.1.4.2.5.1.2.1', controllerUuid: '8ece0051-0eee-427f-b2ea-1abfd52b80cd', title: 'Distribution Reward — Sky.money App',        responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.2.2', controllerUuid: 'd96439a8-df0d-4ba9-973e-896fac953fad', title: 'Distribution Reward — Sky.money Open Source Widgets', responsibleParty: 'Operational GovOps', process: 'Direct Edit',               agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.2.3', controllerUuid: '0f9d7876-d376-4f85-840d-c3cbb96872d3', title: 'Distribution Reward — DeFi Saver',           responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.2.4', controllerUuid: 'dc323489-6f9b-4f0d-a5c6-3c74729cef7c', title: 'Distribution Reward — CoW Swap',             responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.2.5', controllerUuid: '3ea87681-b351-462c-b375-6fb60c817755', title: 'Distribution Reward — ParaSwap',             responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.2.6', controllerUuid: '30be45d8-cd38-4c52-b4d0-ed7225c97b9a', title: 'Distribution Reward — Yearn (Gimme)',        responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.2.7', controllerUuid: 'e1961614-467f-40b0-9e7a-f67e2a70cc97', title: 'Distribution Reward — MOM',                  responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.2.8', controllerUuid: '42349b55-1334-478b-bddd-d692e55e07b9', title: 'Distribution Reward — Lazy Summer Protocol', responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.4.1', controllerUuid: '6296fedf-c2f4-4cdc-a16f-a2b0e8bd19bc', title: 'Distribution Reward — MetaMask',             responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.4.2', controllerUuid: '38f84680-46ff-400b-baeb-62a0684d2aa7', title: 'Distribution Reward — InstaDapp',            responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.4.3', controllerUuid: '32c6b23b-8c5f-4798-97e2-84248365365d', title: 'Distribution Reward — Gnosis Protocol',      responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.4.4', controllerUuid: 'a1f69b33-8bd2-4c68-b4d5-6b8d34ed763e', title: 'Distribution Reward — Piku.co',              responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.2.2.1', controllerUuid: '1f3904b0-28b7-48e2-8cc7-ed67f4b90b68', title: 'Integration Boost — Euler',                  responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.2.2.2', controllerUuid: 'd2f2c0be-765d-4f3b-9dac-e39ab0244a85', title: 'Integration Boost — Curve',                  responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.2.2.3', controllerUuid: '81ee6226-9067-4e72-bd0b-77773b581701', title: 'Integration Boost — Morpho',                 responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.5.2.4.1', controllerUuid: '55b46793-6543-4002-a1d7-9cc33ef46ab6', title: 'Integration Boost — Compound',               responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase' },
  { controllerDocNo: 'A.6.1.1.4.2.7.1.2.1.2.1', controllerUuid: '3dc7cce4-1e15-43e4-907c-d4a074a3531a', title: 'Core Governance Reward Payments',         responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase', note: 'Payment address + transaction records' },
  { controllerDocNo: 'A.6.1.1.4.2.5.1.x.5', controllerUuid: '',                                     title: 'Third Party Partner Payment Records',        responsibleParty: 'Operational GovOps',        process: 'Direct Edit',                 agent: 'Skybase', note: '×8 instances across Distribution Reward integrations' },
];

export const ALL_AGENTS = ['Spark', 'Keel', 'Skybase', 'Grove', 'Obex', 'Pattern', 'Launch Agent 6', 'Launch Agent 7'] as const;
