import type { GraphData } from "@/lib/graphData";
import { counterpartTerm } from "@/lib/searchInflect";
import { fieldMatches, parseReportQuery, rowMatches } from "@/lib/reportFilter";
import {
  buildRadarSearchIndex,
  type NameRow,
  type RadarHit,
  type RadarHitKind,
  type RadarSearchIndex,
} from "@/lib/radarSearchIndex";

export type { RadarHit, RadarHitKind, RadarSearchIndex };

export interface RadarSearchGroup {
  kind: RadarHitKind;
  label: string;
  hits: RadarHit[];
  /** Matches before the per-group cap. */
  total: number;
}

export const RADAR_GROUP_CAP = 20;
const MIN_PARAM_QUERY = 3;
const EXCERPT_RADIUS = 40;
const EVM_PREFIX = /^0x[0-9a-f]{4,}$/i;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{6,}$/;

const cache = new WeakMap<GraphData, RadarSearchIndex>();

/** Rows are built once per graph object (the loader caches one per data base). */
export function getRadarSearchIndex(graph: GraphData): RadarSearchIndex {
  let index = cache.get(graph);
  if (!index) cache.set(graph, (index = buildRadarSearchIndex(graph)));
  return index;
}

function nameTokens(name: string): string[] {
  return name.split(/\s+/).filter(Boolean);
}

function tokenHits(queryToken: string, nameToken: string): boolean {
  if (nameToken === queryToken || nameToken.startsWith(queryToken) || nameToken.includes(queryToken)) {
    return true;
  }
  const extra = counterpartTerm(queryToken);
  return !!extra && (nameToken === extra || nameToken.startsWith(extra) || nameToken.includes(extra));
}

/** Score 3 exact, 2 prefix, 1 substring or every word (plural-tolerant); ties shorter name first. */
export function matchByName<T extends { name: string }>(
  query: string,
  items: T[],
): { item: T; score: number }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qTokens = q.split(/\s+/).filter(Boolean);
  const hits: { item: T; score: number }[] = [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    let score = 0;
    if (name === q) score = 3;
    else if (name.startsWith(q)) score = 2;
    else if (name.includes(q)) score = 1;
    else if (qTokens.every((qt) => nameTokens(name).some((nt) => tokenHits(qt, nt)))) score = 1;
    if (score > 0) hits.push({ item, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length);
}

/** EVM hex of at least four digits, or a Solana-like base58 string with a digit or capital. */
export function looksLikeAddress(query: string): boolean {
  const q = query.trim();
  return EVM_PREFIX.test(q) || (BASE58.test(q) && /[0-9A-Z]/.test(q));
}

function byName(rows: NameRow[], query: string): RadarHit[] {
  return matchByName(query, rows).map((m) => m.item.hit);
}

function byAddress(index: RadarSearchIndex, query: string): RadarHit[] {
  const q = query.trim();
  const evm = EVM_PREFIX.test(q);
  const scored: { hit: RadarHit; score: number }[] = [];
  const seen = new Set<string>();
  for (const row of index.addresses) {
    const [a, b] = evm ? [row.address.toLowerCase(), q.toLowerCase()] : [row.address, q];
    const score = a === b ? 2 : a.startsWith(b) ? 1 : 0;
    const key = `${row.hit.href}|${row.address}`;
    if (!score || seen.has(key)) continue;
    seen.add(key);
    scored.push({ hit: row.hit, score });
  }
  return scored.sort((x, y) => y.score - x.score).map((s) => s.hit);
}

function excerptOf(value: string, needles: string[], cased: boolean): string {
  const hay = cased ? value : value.toLowerCase();
  const at = needles.map((n) => hay.indexOf(n)).find((i) => i >= 0);
  if (at === undefined) return value.length > 2 * EXCERPT_RADIUS ? `${value.slice(0, 2 * EXCERPT_RADIUS)}…` : value;
  const from = Math.max(0, at - EXCERPT_RADIUS);
  const to = Math.min(value.length, at + EXCERPT_RADIUS);
  return `${from > 0 ? "…" : ""}${value.slice(from, to)}${to < value.length ? "…" : ""}`;
}

function byParam(index: RadarSearchIndex, query: string): RadarHit[] {
  const rq = parseReportQuery(query, "broad");
  const out: RadarHit[] = [];
  for (const row of index.params) {
    const field = { label: "param", value: `${row.key}: ${row.value}` };
    if (!rowMatches([field], rq)) continue;
    const inValue = rq.needles.filter((n) => fieldMatches({ label: "v", value: row.value }, n, rq.cased));
    out.push({ ...row.hit, excerpt: excerptOf(row.value, inValue, rq.cased) });
  }
  return out;
}

/** Groups in display order; a group with no hit is omitted. */
export function searchRadar(index: RadarSearchIndex, query: string): RadarSearchGroup[] {
  const q = query.trim();
  if (!q) return [];
  const addressShaped = looksLikeAddress(q);
  const groups: [RadarHitKind, string, RadarHit[]][] = [
    ["actor", "Actors", byName(index.actors, q)],
    ["instance", "Instances", byName(index.instances, q)],
    ["param", "Parameters", !addressShaped && q.length >= MIN_PARAM_QUERY ? byParam(index, q) : []],
    ["address", "Addresses", addressShaped ? byAddress(index, q) : []],
    ["relationship", "Relationships", byName(index.relationships, q)],
  ];
  return groups
    .filter(([, , hits]) => hits.length > 0)
    .map(([kind, label, hits]) => ({ kind, label, hits: hits.slice(0, RADAR_GROUP_CAP), total: hits.length }));
}
