// The facets a Diamond PAU's controller uses, for the Radar PAUs page: one row
// per integration the controller has registered (its id is the bytes32 name,
// "USDS_FACET"), beside the Atlas ceiling for that facet, the "Highest
// Production Rate Limit For <X> Facet" document. The ceiling is the most the
// Atlas designs the facet for, not what a Prime has set, so it is shown, never
// compared. The document is found by name, never by doc_no. Pure.
import type { AtlasNode } from "../types.ts";
import type { PauIntegration, StoredPauSnapshot } from "./pau.ts";

const CEILING_TITLE_RE = /^Highest Production Rate Limit For (.+) Facet$/i;
const FUTURE_RE = /specified in a future/i;
const NAME_BULLET_RE = /^- (?!`)(.+?)\s*$/;
const MAX_RE = /^\s+- `maxAmount`:\s*(.+?)\s*$/;

export interface FacetCeiling {
  docId: string;
  /** "Mint 50,000,000 USDS · Burn unlimited"; null while the Atlas says the details come in a future iteration. */
  text: string | null;
}

export interface FacetRow {
  /** The integration's id as the chain holds it. */
  id: string;
  /** The Atlas's name for the facet ("Uniswap v3 Facet") when a ceiling document names it, else the id spelled out. */
  name: string;
  address: string;
  setAt: PauIntegration["setAt"];
  ceiling: FacetCeiling | null;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** An integration id's text: "0x555344535f46414345540000…" → "USDS_FACET". */
export function integrationName(id: string): string {
  const hex = id.replace(/^0x/, "");
  const chars = hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? [];
  return String.fromCharCode(...chars.filter((c) => c >= 32 && c < 127));
}

/** The ceiling's amounts in order: each named limit's `maxAmount`. */
function ceilingText(content: string): string | null {
  if (FUTURE_RE.test(content)) return null;
  const parts: string[] = [];
  let name = "";
  for (const line of content.split("\n")) {
    const named = NAME_BULLET_RE.exec(line);
    if (named) name = named[1].replace(/\s*\(.*$/, "");
    const max = MAX_RE.exec(line);
    if (max && name) parts.push(`${name} ${/^unlimited$/i.test(max[1]) ? "unlimited" : max[1]}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The ceiling document for an integration name: the one whose facet name starts with it ("AAVE" → "Aave v3"); none when several do. */
function ceilingFor(name: string, docs: Record<string, AtlasNode>): { doc: AtlasNode; facet: string } | null {
  const want = squash(name.replace(/_FACET$/i, ""));
  const hits = Object.values(docs).flatMap((d) => {
    const facet = CEILING_TITLE_RE.exec(d.title.trim())?.[1];
    return facet && want && squash(facet).startsWith(want) ? [{ doc: d, facet }] : [];
  });
  const exact = hits.filter((h) => squash(h.facet) === want);
  return exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
}

const facetOf = (i: PauIntegration): string | null => {
  const f = (i.config as { facet?: unknown } | null)?.facet;
  return typeof f === "string" ? f : null;
};

const spelled = (name: string) => name.replace(/_FACET$/i, "").replace(/_/g, " ") + " Facet";

/** The facets the deployment's controller uses, alphabetical by name; empty for a deployment with none registered. */
export function facetRows(snap: Pick<StoredPauSnapshot, "contracts">, docs: Record<string, AtlasNode> | null): FacetRow[] {
  const rows = snap.contracts.flatMap((c) => c.integrations ?? []).flatMap((i): FacetRow[] => {
    const address = facetOf(i);
    if (!address) return [];
    const name = integrationName(i.id);
    const hit = docs ? ceilingFor(name, docs) : null;
    return [{ id: i.id, name: hit ? `${hit.facet} Facet` : spelled(name), address, setAt: i.setAt, ceiling: hit ? { docId: hit.doc.id, text: ceilingText(hit.doc.content) } : null }];
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
}
