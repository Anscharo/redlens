// Pure data-shaping logic for the On-Chain Addresses report. Kept separate from
// the React component so it's trivially testable against docs.json +
// addresses.atlas.json + addresses.json (the merged loadAddresses() view).
//
// One row per on-chain address the Atlas mentions. The Atlas assigns each
// address a single canonical chain (build-index's detectChain) for display,
// sorting, and its explorer link — an address used on more than one chain
// (AddressInfo.chains) still resolves to one row here, but that row's
// `balances` sums every chain it's deployed on (see mergeChainBalances), not
// just the primary. If a future build ever keys an address per-chain for
// display too, rowKey (address|chain) already splits them cleanly.

import type { AtlasNode, AddressInfo } from "@/types";
import { toCSV } from "@/lib/csv";
import { atlasUrl } from "@/lib/routes";
import type { SearchField } from "@/lib/reportFilter";
import type { AddressBalances, BalanceMap } from "@/lib/balances";
import { formatUnits } from "@/lib/tokens";

// Dedicated balance columns in the report + CSV; every other fetched token
// folds into "Other Token Balances".
export const PRIMARY_BALANCE_SYMBOLS = ["ETH", "USDS", "SKY"] as const;

// The buckets the report classifies every address into. The last two are
// Solana-only: an account there is either executable code (Program) or data a
// program owns (Program Account) — neither is an EVM-style contract, and
// neither is an EOA.
export type AddressType =
  | "EOA"
  | "Multisig"
  | "Token"
  | "Sky Internal Contract"
  | "Other Contract"
  | "Program"
  | "Program Account";

// Stable pill order (also the table's secondary sort key).
export const ADDRESS_TYPES: AddressType[] = [
  "EOA",
  "Multisig",
  "Token",
  "Sky Internal Contract",
  "Other Contract",
  "Program",
  "Program Account",
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

// Solana accountType (getAccountInfo, see scripts/lib/solana-accounts.mjs) →
// report bucket. Only a System-Program-owned keypair is an EOA; everything else
// non-executable is data some program owns, which is why reading Solana through
// the EVM contract/EOA split labelled all 40 of these addresses "EOA".
// An account the RPC has never seen is as unused as a bare EVM keypair, so it
// files as EOA too — `accountType` on the row still says "missing".
const SOLANA_TYPE: Record<string, AddressType> = {
  program: "Program",
  mint: "Token",
  wallet: "EOA",
  missing: "EOA",
  // System-owned but off-curve: no private key can exist for it, so it is a
  // program-derived vault, not a keypair.
  pda: "Program Account",
  "token-account": "Program Account",
  "token-multisig": "Program Account",
  "program-account": "Program Account",
};

// Priority-ordered classifier. Most specific signal wins:
//   Multisig  — the Atlas tags it, or it's a Gnosis Safe proxy.
//   Token     — the Atlas tags it a token / underlying collateral asset.
//   Solana    — accountType settles it outright (SOLANA_TYPE above).
//   Sky        — it's in the Sky chainlog, or a contract holding a Sky-system role.
//   EOA       — no on-chain bytecode.
//   Other      — a contract we can't place more precisely (e.g. a VoteDelegate).
//
// info.isContract is the eth_getCode answer as of the last build-addresses run
// (address-code.mjs). hasCode is the same signal taken live during a balances
// refresh, so it's fresher when present (null before the first refresh) and
// overrides isContract; they should agree otherwise.
export function classifyAddress(info: AddressInfo, hasCode?: boolean | null): AddressType {
  const roles = info.roles ?? [];
  const has = (r: string) => roles.includes(r);
  if (has("multisig") || info.etherscanName === "SafeProxy") return "Multisig";
  if (has("token") || has("underlying-asset")) return "Token";
  if (info.accountType) return SOLANA_TYPE[info.accountType] ?? "Program Account";
  if (info.chainlogId || (info.isContract && roles.some((r) => SKY_SYSTEM_ROLES.has(r))))
    return "Sky Internal Contract";
  const isContract = hasCode ?? info.isContract;
  if (!isContract) return "EOA";
  return "Other Contract";
}

// How a doc refers to the address:
//   address — the doc writes the 0x/base58 address literally (addressRefs).
//   name    — the doc names the contract by its CHAIN_LOG key (e.g.
//             MCD_PAUSE_PROXY) but not the address itself.
//   both    — the doc does both.
export type MentionVia = "address" | "name" | "both";

// A single Atlas doc that mentions the address.
export interface AddressDocRef {
  id: string; // doc UUID — the stable identity, used for the app link
  docNo: string;
  title: string;
  type: string;
  via: MentionVia;
}

// A doc reference before its `via` is resolved (same fields, minus via).
type DocMeta = Omit<AddressDocRef, "via">;

// A CHAIN_LOG key worth scanning prose for is a SCREAMING_SNAKE registry key
// (MCD_PAUSE_PROXY, OPTIMISM_DAI_BRIDGE, ALLOCATOR_SPARK_A_VAULT). Bare token
// symbols (USDS, DAI, ETH, USDC) are excluded — they appear throughout the
// Atlas as prose and would flood the report with non-contract mentions.
export function isContractKey(chainlogId: string): boolean {
  return chainlogId.includes("_");
}

export const MENTION_VIA_LABEL: Record<MentionVia, string> = {
  address: "address",
  name: "chainlog name",
  both: "address + name",
};

export interface OnchainAddressRow {
  address: string; // normalized key (lowercase EVM / base58 Solana)
  rowKey: string; // `${address}|${chain}` — unique per rendered row
  chain: string;
  type: AddressType;
  chainlogId: string | null; // CHAIN_LOG name, mainnet only
  owner: string | null; // Associated Owner — atlas-derived entityLabel
  etherscanName: string | null; // verified on-chain contract name
  // Display name for the "Chainlog / On-Chain Name" column: the chainlog key if
  // the address is in the Sky chainlog, else the verified Etherscan name.
  registryName: string | null;
  registrySource: "chainlog" | "onchain" | null;
  isContract: boolean;
  isProxy: boolean;
  implementation: string | null; // proxy implementation address (isProxy only)
  // Solana only: the raw getAccountInfo answer behind `type`. Kept alongside it
  // because the bucket is deliberately coarse — "Program Account" covers a PDA,
  // a token account and an SPL multisig alike, and the CSV should not.
  accountType: string | null;
  programOwner: string | null; // owning program's pubkey
  programOwnerName: string | null; // its friendly name, when known
  explorerUrl: string;
  roles: string[];
  aliases: string[];
  expectedTokens: string[];
  balances: BalanceMap; // symbol -> { raw, decimals }, from the last refresh
  balancesCheckedAt: string | null; // ISO time this address was last priced
  docs: AddressDocRef[]; // every mentioning doc, sorted by doc_no
}

// Exact decimal string for one token symbol on a row ("" if not held/fetched).
export function balanceExact(row: OnchainAddressRow, symbol: string): string {
  const b = row.balances[symbol];
  return b ? formatUnits(b.raw, b.decimals) : "";
}

// Non-primary token balances on a row (e.g. USDC, DAI, WETH), symbol asc.
export function otherBalances(row: OnchainAddressRow): { symbol: string; amount: string }[] {
  return Object.entries(row.balances)
    .filter(([s]) => !(PRIMARY_BALANCE_SYMBOLS as readonly string[]).includes(s))
    .map(([symbol, b]) => ({ symbol, amount: formatUnits(b.raw, b.decimals) }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// Sums same-symbol balances across every chain an address is deployed on into
// one flat map. Safe to sum raw amounts as-is: a native gas symbol is chain-
// specific (ETH vs POL vs AVAX — see NATIVE_TOKEN in tokens.ts), and every
// ERC20 symbol in TOKEN_REGISTRY is currently priced on exactly one chain, so
// today's data never puts the same symbol on two chains with different
// decimals. Keeps the first-seen decimals if that ever changes.
function mergeChainBalances(rows: (AddressBalances | undefined)[]): BalanceMap {
  const merged: BalanceMap = {};
  for (const row of rows) {
    if (!row) continue;
    for (const [symbol, b] of Object.entries(row.balances)) {
      const existing = merged[symbol];
      merged[symbol] = existing
        ? { raw: (BigInt(existing.raw) + BigInt(b.raw)).toString(), decimals: existing.decimals }
        : { ...b };
    }
  }
  return merged;
}

const meta = (d: AtlasNode): DocMeta => ({ id: d.id, docNo: d.doc_no, title: d.title, type: d.type });
const byDocNo = (a: DocMeta, b: DocMeta) => a.docNo.localeCompare(b.docNo, undefined, { numeric: true });

// address (lowercased) → the docs whose addressRefs include it.
function buildAddrToDocs(docs: Record<string, AtlasNode>): Map<string, DocMeta[]> {
  const map = new Map<string, DocMeta[]>();
  for (const d of Object.values(docs)) {
    for (const raw of d.addressRefs ?? []) {
      const key = raw.toLowerCase();
      const list = map.get(key) ?? [];
      // A doc lists each address once in addressRefs, but guard against dupes.
      if (!list.some((r) => r.id === d.id)) list.push(meta(d));
      map.set(key, list);
    }
  }
  return map;
}

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;

// CHAIN_LOG key → the docs whose content names that key as a whole word. One
// combined-regex pass over all doc content (word boundaries treat the
// underscores inside a key as internal, so MCD_VAT never matches MCD_VAT_X).
function buildNameToDocs(
  docs: Record<string, AtlasNode>,
  names: Set<string>,
): Map<string, DocMeta[]> {
  const map = new Map<string, DocMeta[]>();
  if (names.size === 0) return map;
  const re = new RegExp(
    `\\b(${[...names].map((n) => n.replace(RE_ESCAPE, "\\$&")).join("|")})\\b`,
    "g",
  );
  for (const d of Object.values(docs)) {
    const content = d.content ?? "";
    if (!content) continue;
    re.lastIndex = 0;
    const hits = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) hits.add(m[1]);
    for (const name of hits) {
      const list = map.get(name) ?? [];
      list.push(meta(d));
      map.set(name, list);
    }
  }
  return map;
}

// Merge the address-referenced docs and the chainlog-name-referenced docs for a
// single address into one `via`-tagged, doc_no-sorted list.
function mergeDocRefs(addrDocs: DocMeta[], nameDocs: DocMeta[]): AddressDocRef[] {
  const byId = new Map<string, { m: DocMeta; addr: boolean; name: boolean }>();
  for (const m of addrDocs) byId.set(m.id, { m, addr: true, name: false });
  for (const m of nameDocs) {
    const e = byId.get(m.id);
    if (e) e.name = true;
    else byId.set(m.id, { m, addr: false, name: true });
  }
  return [...byId.values()]
    .map(({ m, addr, name }) => ({ ...m, via: (addr && name ? "both" : addr ? "address" : "name") as MentionVia }))
    .sort(byDocNo);
}

// Sort key: chain, then type (by ADDRESS_TYPES order), then the human label.
function sortLabel(r: OnchainAddressRow): string {
  return r.registryName ?? r.owner ?? r.address;
}

export function buildOnchainAddressRows(
  docs: Record<string, AtlasNode>,
  addrMap: Record<string, AddressInfo>,
  balancesByAddress: Record<string, AddressBalances> = {},
): OnchainAddressRow[] {
  const addrToDocs = buildAddrToDocs(docs);
  const typeRank = new Map(ADDRESS_TYPES.map((t, i) => [t, i]));

  // Scan prose for the contract-key-shaped chainlog names present in the map,
  // so a doc that names MCD_PAUSE_PROXY without its address is still counted.
  const contractKeys = new Set(
    Object.values(addrMap)
      .map((i) => i.chainlogId)
      .filter((id): id is string => !!id && isContractKey(id)),
  );
  const nameToDocs = buildNameToDocs(docs, contractKeys);

  const rows: OnchainAddressRow[] = Object.entries(addrMap).map(([address, info]) => {
    const key = address.toLowerCase();
    const addrDocs = addrToDocs.get(key) ?? addrToDocs.get(address) ?? [];
    const nameDocs =
      info.chainlogId && isContractKey(info.chainlogId)
        ? (nameToDocs.get(info.chainlogId) ?? [])
        : [];
    // Keyed by address|chain, matching atlas_addresses' PRIMARY KEY (address, chain) — see balances.ts.
    // hasCode/checkedAt come from the primary chain's row specifically (a
    // per-chain fact); the row's balances sum every chain (mergeChainBalances).
    const primaryBal = balancesByAddress[`${key}|${info.chain}`] ?? balancesByAddress[`${address}|${info.chain}`];
    const chainBals = info.chains.map(
      (chain) => balancesByAddress[`${key}|${chain}`] ?? balancesByAddress[`${address}|${chain}`],
    );
    return {
      address,
      rowKey: `${address}|${info.chain}`,
      chain: info.chain,
      type: classifyAddress(info, primaryBal?.hasCode),
      chainlogId: info.chainlogId ?? null,
      owner: info.entityLabel ?? null,
      etherscanName: info.etherscanName ?? null,
      registryName: info.chainlogId ?? info.etherscanName ?? null,
      registrySource: info.chainlogId ? "chainlog" : info.etherscanName ? "onchain" : null,
      isContract: info.isContract,
      isProxy: info.isProxy,
      implementation: info.implementation ?? null,
      accountType: info.accountType ?? null,
      programOwner: info.programOwner ?? null,
      programOwnerName: info.programOwnerName ?? null,
      explorerUrl: info.explorerUrl,
      roles: info.roles ?? [],
      aliases: info.aliases ?? [],
      expectedTokens: info.expectedTokens ?? [],
      balances: mergeChainBalances(chainBals),
      balancesCheckedAt: primaryBal?.checkedAt ?? null,
      docs: mergeDocRefs(addrDocs, nameDocs),
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
    "Account Type",
    "Program Owner",
    "Roles",
    "Etherscan Name",
    "Is Contract",
    "Implementation",
    "Explorer URL",
    "ETH Balance",
    "USDS Balance",
    "SKY Balance",
    "Other Token Balances",
    "Balances Updated",
    "Doc No",
    "Doc Title",
    "Doc Type",
    "Mention Via",
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
      r.accountType ?? "",
      r.programOwnerName ? `${r.programOwnerName} (${r.programOwner})` : (r.programOwner ?? ""),
      r.roles.join(", "),
      r.etherscanName ?? "",
      r.isContract ? "yes" : "no",
      r.implementation ?? "",
      r.explorerUrl,
      balanceExact(r, "ETH"),
      balanceExact(r, "USDS"),
      balanceExact(r, "SKY"),
      otherBalances(r).map((b) => `${b.symbol}=${b.amount}`).join("; "),
      r.balancesCheckedAt ? r.balancesCheckedAt.slice(0, 10) : "",
    ];
    if (r.docs.length === 0) {
      body.push([...base, "", "", "", "", "", ""]);
      continue;
    }
    for (const d of r.docs) {
      body.push([...base, d.docNo, d.title, d.type, MENTION_VIA_LABEL[d.via], d.id, atlasUrl(d.id)]);
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
    { label: "on-chain name", value: r.etherscanName ?? "" },
    { label: "owner", value: r.owner ?? "", despace: true },
    { label: "chain", value: r.chain },
    { label: "type", value: r.type },
    { label: "account type", value: r.accountType ?? "" },
    { label: "program owner", value: [r.programOwnerName, r.programOwner].filter(Boolean).join(" "), hidden: true },
    { label: "implementation", value: r.implementation ?? "", hidden: true },
    { label: "roles", value: r.roles.join(" "), hidden: true },
    { label: "aliases", value: r.aliases.join(" "), hidden: true },
    { label: "tokens", value: r.expectedTokens.join(" "), hidden: true },
    { label: "doc nos", value: r.docs.map((d) => d.docNo).join(" ") },
    { label: "doc titles", value: r.docs.map((d) => d.title).join(" · "), hidden: true },
  ];
}
