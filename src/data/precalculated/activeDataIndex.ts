import type { AtlasNode } from '../../types';
import { AGENT_META } from './ofResponsibilities';

export interface ActiveDataEntry {
  controllerDocNo: string;
  controllerUuid: string;
  title: string;
  context?: string;               // integration name for generic titles
  entityName: string;             // e.g. "Soter Labs", "Redline Facilitation Group"
  entityRole: string;             // Atlas role, e.g. "Operational GovOps"
  process: 'Direct Edit' | 'Alignment Conserver Changes';
  agent: string | null;
}

const PARTY_RE = /[Rr]esponsible [Pp]arty[:\s]+(?:is\s+(?:the\s+)?)?([^\.\n\-]+)/;
const PROCESS_RE = /[Uu]pdate [Pp]rocess[:\s]+(?:must follow the protocol for\s+)?['\`]?([^'\`\.\n]+)['\`]?/;
const GENERIC_TITLES = new Set([
  'Distribution Reward Payments',
  'Integration Boost Payments',
  'Third Party Partner Payment Addresses And Transaction Records',
]);

function agentFromDocNo(docNo: string): string | null {
  if (docNo.startsWith('A.6.1.1.1.')) return 'Spark';
  if (docNo.startsWith('A.6.1.1.2.')) return 'Grove';
  if (docNo.startsWith('A.6.1.1.3.')) return 'Keel';
  if (docNo.startsWith('A.6.1.1.4.')) return 'Skybase';
  if (docNo.startsWith('A.6.1.1.5.')) return 'Obex';
  if (docNo.startsWith('A.6.1.1.6.')) return 'Pattern';
  return null;
}

function resolveEntity(raw: string, agent: string | null) {
  const p = raw.trim().replace(/\.$/, '').toLowerCase();
  if (p.includes('operational govops') || p === 'operational govops soter labs') {
    return { entityName: 'Soter Labs', entityRole: 'Operational GovOps' };
  }
  if (p === 'operational facilitator') {
    const meta = agent ? AGENT_META[agent] : null;
    return {
      entityName: meta?.operationalFacilitator ?? 'Operational Facilitator',
      entityRole: 'Operational Facilitator',
    };
  }
  const name = raw.trim().replace(/\.$/, '');
  return { entityName: name, entityRole: name };
}

function resolveTitle(doc: AtlasNode, docs: Record<string, AtlasNode>) {
  if (!GENERIC_TITLES.has(doc.title)) return { title: doc.title };
  // Instance node is at doc_no minus the last 2 segments (e.g. .3.4 → .3 → instance)
  const parts = doc.doc_no.split('.');
  const instanceDocNo = parts.slice(0, -2).join('.');
  const instanceDoc = Object.values(docs).find(d => d.doc_no === instanceDocNo);
  if (!instanceDoc) return { title: doc.title };
  const context = instanceDoc.title.replace(/\s+Instance Configuration Document$/i, '');
  return { title: doc.title, context };
}

export function buildActiveDataIndex(docs: Record<string, AtlasNode>): ActiveDataEntry[] {
  return Object.values(docs)
    .filter(d => d.type === 'Active Data Controller')
    .sort((a, b) => a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true }))
    .map(d => {
      const pm = d.content.match(PARTY_RE);
      const prm = d.content.match(PROCESS_RE);
      const rawParty = pm ? pm[1] : 'Unknown';
      const rawProcess = prm ? prm[1].replace(/['\`.]/g, '').trim() : 'Direct Edit';
      const agent = agentFromDocNo(d.doc_no);
      const { entityName, entityRole } = resolveEntity(rawParty, agent);
      const { title, context } = resolveTitle(d, docs);
      const process: ActiveDataEntry['process'] = rawProcess.toLowerCase().includes('alignment')
        ? 'Alignment Conserver Changes' : 'Direct Edit';
      return { controllerDocNo: d.doc_no, controllerUuid: d.id, title, context, entityName, entityRole, process, agent };
    });
}

export const ALL_AGENTS = ['Spark', 'Grove', 'Keel', 'Skybase', 'Obex', 'Pattern', 'Launch Agent 6', 'Launch Agent 7'] as const;
