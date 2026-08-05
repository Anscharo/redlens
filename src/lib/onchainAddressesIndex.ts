// Pure data-shaping logic for the On-Chain Addresses report. Kept separate from
// the React component so it's trivially testable against docs.json +
// addresses.atlas.json + addresses.json (the merged loadAddresses() view).
//
// One row per on-chain address the Atlas mentions. The Atlas assigns each
// address a single canonical chain (build-index's detectChain), so an address
// used on more than one chain still resolves to one row here — the report notes
// this and lists every mentioning doc on that row. If a future build ever keys
// an address per-chain, rowKey (address|chain) already splits them cleanly.

import type { AtlasNode, AddressInfo } from "../types";
import { toCSV } from "./csv";
import { atlasUrl } from "./routes";
import type { SearchField } from "./reportFilter";

// The five buckets the report classifies every address into.
export type AddressType =
  | "EOA"
  | "Multisig"
  | "Token"
  | "Sky Internal Contract"
  | "Other Contract";

// Stable pill order (also the table's secondary sort key).
export const ADDRESS_TYPES: AddressType[] = [
  "EOA",
  "Multisig",
  "Token",
  "Sky Internal Contract",
  "Other Contract",
];

// Structural roles that mark an address as part of the Sky protocol's own
// contract system (as opposed to an external token or a delegate's contract).
const SKY_SYSTEM_ROLES = new Set([
  "proxy",
  "subproxy",
  "buffer",
  "vault",
  "controller",
  "registry",
  "executor",
  "incentive-pool",
  "pool",
  "reserve",
  "treasury",
  "allocator-role",
  "oracle",
  "staking-rewards",
  "vesting",
]);

// Priority-ordered classifier. Most specific signal wins:
//   Multisig  — the Atlas tags it, or it's a Gnosis Safe proxy.
//   Token     — the Atlas tags it a token / underlying collateral asset.
//   Sky        — it's in the Sky chainlog, or a contract holding a Sky-system role.
//   EOA       — not a contract on-chain.
//   Other      — a contract we can't place more precisely (e.g. a VoteDelegate).
export function classifyAddress(info: AddressInfo): AddressType {
  const roles = info.roles ?? [];
  const has = (r: string) => roles.includes(r);
  if (has("multisig") || info.etherscanName === "SafeProxy") return "Multisig";
  if (has("token") || has("underlying-asset")) return "Token";
  if (info.chainlogId || (info.isContract && roles.some((r) => SKY_SYSTEM_ROLES.has(r))))
    return "Sky Internal Contract";
  if (!info.isContract) return "EOA";
  return "Other Contract";
}

// A single Atlas doc that mentions the address.
export interface AddressDocRef {
  id: string; // doc UUID — the stable identity, used for the app link
  docNo: string;
  title: string;
  type: string;
}

export interface OnchainAddressRow {
  address: string; // normalized key (lowercase EVM / base58 Solana)
  rowKey: string; // `${address}|${chain}` — unique per rendered row
  chain: string;
  type: AddressType;
  chainlogId: string | null; // CHAIN_LOG name, mainnet only
  owner: string | null; // Associated Owner — atlas-derived entityLabel
  etherscanName: string | null;
  isContract: boolean;
  isProxy: boolean;
  explorerUrl: string;
  roles: string[];
  aliases: string[];
  expectedTokens: string[];
  docs: AddressDocRef[]; // every mentioning doc, sorted by doc_no
}

// address (lowercased) → the docs whose addressRefs include it.
function buildAddrToDocs(docs: Record<string, AtlasNode>): Map<string, AddressDocRef[]> {
  const map = new Map<string, AddressDocRef[]>();
  for (const d of Object.values(docs)) {
    for (const raw of d.addressRefs ?? []) {
      const key = raw.toLowerCase();
      const list = map.get(key) ?? [];
      // A doc lists each address once in addressRefs, but guard against dupes.
      if (!list.some((r) => r.id === d.id)) {
        list.push({ id: d.id, docNo: d.doc_no, title: d.title, type: d.type });
      }
      map.set(key, list);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.docNo.localeCompare(b.docNo, undefined, { numeric: true }));
  }
  return map;
}

// Sort key: chain, then type (by ADDRESS_TYPES order), then the human label.
function sortLabel(r: OnchainAddressRow): string {
  return r.chainlogId ?? r.owner ?? r.address;
}

export function buildOnchainAddressRows(
  docs: Record<string, AtlasNode>,
  addrMap: Record<string, AddressInfo>,
): OnchainAddressRow[] {
  const addrToDocs = buildAddrToDocs(docs);
  const typeRank = new Map(ADDRESS_TYPES.map((t, i) => [t, i]));

  const rows: OnchainAddressRow[] = Object.entries(addrMap).map(([address, info]) => {
    const key = address.toLowerCase();
    return {
      address,
      rowKey: `${address}|${info.chain}`,
      chain: info.chain,
      type: classifyAddress(info),
      chainlogId: info.chainlogId ?? null,
      owner: info.entityLabel ?? null,
      etherscanName: info.etherscanName ?? null,
      isContract: info.isContract,
      isProxy: info.isProxy,
      explorerUrl: info.explorerUrl,
      roles: info.roles ?? [],
      aliases: info.aliases ?? [],
      expectedTokens: info.expectedTokens ?? [],
      docs: addrToDocs.get(key) ?? addrToDocs.get(address) ?? [],
    };
  });

  return rows.sort((a, b) => {
    if (a.chain !== b.chain) return a.chain.localeCompare(b.chain);
    const ta = typeRank.get(a.type) ?? 99;
    const tb = typeRank.get(b.type) ?? 99;
    if (ta !== tb) return ta - tb;
    return sortLabel(a).localeCompare(sortLabel(b), undefined, { numeric: true });
  });
}

// Total mentioning-doc count across the given rows — the number of rows the CSV
// emits (long format: one CSV row per address × mentioning doc). An address
// with zero mentions still emits one row (see onchainAddressRowsToCSV).
export function onchainCsvRowCount(rows: readonly OnchainAddressRow[]): number {
  let n = 0;
  for (const r of rows) n += Math.max(1, r.docs.length);
  return n;
}

// Human-readable pipe-joined doc list for the on-screen "Docs" cell and, as a
// convenience, one column of the CSV. `A.1.2 : Title | A.3.4 : Title`.
export function docsSummary(row: OnchainAddressRow): string {
  return row.docs.map((d) => `${d.docNo} : ${d.title}`).join(" | ");
}

// Long-format CSV: one row per (address × mentioning doc) so each row carries
// exactly one doc's UUID + Atlas Link (never a joined multi-doc cell — see the
// new-report skill, rule 6b). Address-level fields repeat per doc row. An
// address with no mentioning doc still emits one row with empty doc columns.
export function onchainAddressRowsToCSV(rows: readonly OnchainAddressRow[]): string {
  const headers = [
    "Address",
    "Chainlog Name",
    "Associated Owner",
    "Chain",
    "Type",
    "Roles",
    "Etherscan Name",
    "Is Contract",
    "Explorer URL",
    "Doc No",
    "Doc Title",
    "Doc Type",
    "Doc UUID",
    "Atlas Link",
  ];
  const body: (string | number)[][] = [];
  for (const r of rows) {
    const base = [
      r.address,
      r.chainlogId ?? "",
      r.owner ?? "",
      r.chain,
      r.type,
      r.roles.join(", "),
      r.etherscanName ?? "",
      r.isContract ? "yes" : "no",
      r.explorerUrl,
    ];
    if (r.docs.length === 0) {
      body.push([...base, "", "", "", "", ""]);
      continue;
    }
    for (const d of r.docs) {
      body.push([...base, d.docNo, d.title, d.type, d.id, atlasUrl(d.id)]);
    }
  }
  return toCSV(headers, body);
}

// Search haystack for one row. `hidden` fields are searched but not shown as
// their own column — a match there surfaces via MatchAside.
export function addrSearchFields(r: OnchainAddressRow): SearchField[] {
  return [
    { label: "address", value: r.address },
    { label: "chainlog", value: r.chainlogId ?? "" },
    { label: "owner", value: r.owner ?? "", despace: true },
    { label: "chain", value: r.chain },
    { label: "type", value: r.type },
    { label: "roles", value: r.roles.join(" "), hidden: true },
    { label: "etherscan", value: r.etherscanName ?? "", hidden: true },
    { label: "aliases", value: r.aliases.join(" "), hidden: true },
    { label: "tokens", value: r.expectedTokens.join(" "), hidden: true },
    { label: "doc nos", value: r.docs.map((d) => d.docNo).join(" ") },
    { label: "doc titles", value: r.docs.map((d) => d.title).join(" · "), hidden: true },
  ];
}
