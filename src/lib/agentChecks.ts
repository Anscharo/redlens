// What the stored on-chain snapshots say about a Prime's Agent Creation and
// Agent Token instances. A SubProxy Account is checked against the admin role
// (DEFAULT_ADMIN_ROLE) on the Prime's controller contracts, from the controller
// snapshots' live hasRole; an agent token's name, symbol and supply against the
// daily Ethereum chain_state snapshot. Nothing here is read live: where the
// snapshots hold no answer the check says so, and where the atlas leaves a
// value to be specified while the token is on-chain the atlas is probably behind.
import type { ChainValue } from "./chainstateTypes.ts";
import type { StoredPauSnapshot } from "./pau.ts";
import { addressCheckId, NOT_INDEXED, type AddressStatus } from "./pauAddressChecks.ts";
import { contractLabel } from "./pauHolderNames.ts";
import { chainInText, instanceChain } from "./pauInstanceChain.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";
import { parseStated } from "./pauParams.ts";
import { exactAmount } from "./pauView.ts";

export type PlainLine = { label: string; value: string } | { text: string };

/** A row's verdict, said in full: "candidate" when the chain holds what the atlas leaves to be specified. */
export interface PlainCheck {
  status: AddressStatus | "candidate";
  head: string;
  lines: PlainLine[];
}

/** chain_state's values, by contract address in any case. */
export type ChainValues = Record<string, Record<string, ChainValue>>;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const UNSTATED_RE = /specified in a future/i;
const isAdminRole = (role: string) => /^0x0{64}$/.test(role) || /DEFAULT_ADMIN/i.test(role);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const unsure = (text: string): PlainCheck => ({ status: "unsure", head: "Can't be checked", lines: [{ text: `${text[0].toUpperCase()}${text.slice(1)}.` }] });

function subProxyCheck(address: string, chain: string | null, snaps: StoredPauSnapshot[]): PlainCheck {
  const contracts = chain ? snaps.filter((s) => s.chain === chain).flatMap((s) => s.contracts) : [];
  if (contracts.length === 0) return unsure(chain ? NOT_INDEXED : "chain not recognised");
  const admins = contracts.flatMap((c) => (c.roles ?? []).filter((r) => isAdminRole(r.role) && r.holds).map((r) => ({ c, account: r.account.toLowerCase() })));
  const mine = [...new Set(admins.filter((a) => a.account === address).map((a) => contractLabel(a.c)))];
  if (mine.length) return { status: "match", head: "Admin on-chain", lines: [{ label: "Admin of", value: mine.join(", ") }] };
  const others = [...new Set(admins.map((a) => a.account))];
  if (others.length === 0) return unsure("the admin role is not read yet");
  return { status: "mismatch", head: "Differs from the chain", lines: [{ label: "On-chain admin", value: others.map(short).join(", ") }, { label: "Atlas", value: short(address) }] };
}

/** The instance's token as chain_state read it: the first listed token address on Ethereum that it holds values for. */
function tokenOf(src: ValueSource, values: ChainValues): Record<string, ChainValue> | null {
  for (const [name, [value]] of Object.entries(src.params)) {
    const v = value.trim().toLowerCase();
    if (/token address/i.test(name) && ADDRESS_RE.test(v) && (chainInText(name) ?? "ethereum") === "ethereum" && values[v]) return values[v];
  }
  return null;
}

function tokenAddressCheck(name: string, address: string, values: ChainValues): PlainCheck {
  const chain = chainInText(name) ?? "ethereum";
  const token = chain === "ethereum" ? values[address] : undefined;
  if (!token) return unsure(NOT_INDEXED);
  return { status: "match", head: "Token on-chain", lines: [{ label: "Name", value: String(token.name ?? "") }, { label: "Symbol", value: String(token.symbol ?? "") }] };
}

/** The supply chain_state read, in whole tokens; null when it did not read it. */
function onchainSupply(token: Record<string, ChainValue>): string | null {
  const decimals = token.decimals == null ? NaN : Number(token.decimals);
  return typeof token.totalSupply === "string" && Number.isInteger(decimals) ? exactAmount(token.totalSupply, decimals) : null;
}

const FIELD: Record<string, { read: (t: Record<string, ChainValue>) => string | null; same: (atlas: string, chain: string) => boolean }> = {
  "Token Name": { read: (t) => (typeof t.name === "string" ? t.name : null), same: (a, c) => a.trim().toLowerCase() === c.trim().toLowerCase() },
  "Token Symbol": { read: (t) => (typeof t.symbol === "string" ? t.symbol : null), same: (a, c) => a.trim().toLowerCase() === c.trim().toLowerCase() },
  "Genesis Supply": { read: onchainSupply, same: (a, c) => { const s = parseStated(a); return s?.kind === "amount" && s.units === c; } },
};

function tokenFieldCheck(name: string, stated: string, token: Record<string, ChainValue>): PlainCheck | null {
  const onchain = FIELD[name].read(token);
  if (onchain === null) return null;
  const shown = name === "Genesis Supply" ? onchain.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : onchain;
  if (UNSTATED_RE.test(stated)) return { status: "candidate", head: "The atlas states no value, but the chain holds one", lines: [{ label: "On-chain", value: shown }] };
  if (FIELD[name].same(stated, onchain)) return { status: "match", head: "Matches the chain", lines: [{ label: "On-chain", value: shown }] };
  const note: PlainLine[] = name === "Genesis Supply" ? [{ text: "This is the current supply: burns or emissions since genesis also change it." }] : [];
  return { status: "mismatch", head: "Differs from the chain", lines: [{ label: "On-chain", value: shown }, { label: "Atlas", value: stated }, ...note] };
}

/** One param's check, or null for a param neither instance kind checks. */
function paramCheck(src: ValueSource, name: string, value: string, snaps: StoredPauSnapshot[], values: ChainValues | null): PlainCheck | null {
  const v = value.trim().toLowerCase();
  if (/subproxy/i.test(name) && ADDRESS_RE.test(v)) return subProxyCheck(v, chainInText(name) ?? instanceChain(src), snaps);
  if (!values || !("Genesis Supply" in src.params || "Token Symbol" in src.params)) return null;
  if (/token address/i.test(name) && ADDRESS_RE.test(v)) return tokenAddressCheck(name, v, values);
  const token = FIELD[name] ? tokenOf(src, values) : null;
  return token ? tokenFieldCheck(name, value, token) : null;
}

/** Every Agent Creation SubProxy and Agent Token param of the prime's instances; token params only once `values` (chain_state) has loaded. */
export function checkAgentInstances(sources: ValueSource[], snaps: StoredPauSnapshot[], values: ChainValues | null): Map<string, PlainCheck> {
  const lower = values ? Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v])) : null;
  const out = new Map<string, PlainCheck>();
  for (const src of sources) {
    if (!src.docId || src.constant) continue;
    for (const [name, [value]] of Object.entries(src.params)) {
      const c = paramCheck(src, name, value, snaps, lower);
      if (c) out.set(addressCheckId(src.docId, name), c);
    }
  }
  return out;
}
