// Which account of the Solana ALM program (an svm deployment,
// src/server/pau/svm-snapshot.ts) holds an atlas value, keyed by that
// account's address as the snapshot keys its limits:
//   - an instance states its Integration Account Address, which limits its
//     deposits ("in"); the program limits only outflow, so a withdrawal has no
//     limit on chain at all ("no-limit");
//   - a prime-level limit names its account in its title: "<SYM> Reserve" is
//     the Reserve of that mint, "<A> For <B> Swap" the AtomicSwap from A to B,
//     and "Maximum <SYM> Bridged … Via SkyLink" / "… Via Circle CCTP" the
//     LzBridge / CctpBridge of that mint. Each symbol's mint is the one the
//     prime's own instances state for it (their Asset Supplied and Underlying
//     Asset Address), never assumed: a symbol they state two mints for has
//     none. A title several accounts fit takes them all, so the value reads
//     ambiguous unless every one agrees.
// A Reserve the chain does not hold is keyed "reserve:<mint>", as the snapshot
// records it unset; a swap or bridge it does not hold has no key. A stated
// address that is not base58 ("N/A", "To be specified") names no account. Keys
// keep the case the chain writes them in. Pure.
import type { LiveRateLimit, StoredPauSnapshot } from "./pau.ts";
import { chainSnaps, instanceChain } from "./pauInstanceChain.ts";
import type { InstanceKey, ValueSource } from "./pauInstanceKeys.ts";
import { isBase58Address, isSvmChain } from "./pauRegistry.ts";

/** Whether a value source is on a chain the Solana ALM program serves. */
export const isSvmSource = (src: ValueSource): boolean => {
  const chain = instanceChain(src);
  return !!chain && isSvmChain(chain);
};

/** The sides the program sets no limit on: it limits only what flows out. */
export const UNLIMITED_SIDES = new Set(["out"]);

/** The param stating an instance's Integration account, and the one stating its token's mint. */
export const INTEGRATION_PARAM_RE = /^integration account address$/i;
export const MINT_PARAM_RE = /^underlying asset address$/i;

const param = (src: ValueSource, re: RegExp) => Object.entries(src.params).find(([n]) => re.test(n))?.[1][0]?.trim() ?? null;
/** A param's value when it is written as an address. */
const address = (src: ValueSource, re: RegExp) => {
  const v = param(src, re);
  return v && isBase58Address(v) ? v : null;
};

/** Each token symbol's mint, from the sources that state both; a symbol stated with two mints has none. */
export function svmMints(sources: ValueSource[]): Map<string, string> {
  const out = new Map<string, string>();
  const clash = new Set<string>();
  for (const s of sources.filter(isSvmSource)) {
    const sym = param(s, /^asset supplied/i)?.toLowerCase();
    const mint = address(s, MINT_PARAM_RE);
    if (!sym || !mint) continue;
    if (out.has(sym) && out.get(sym) !== mint) clash.add(sym);
    out.set(sym, mint);
  }
  for (const sym of clash) out.delete(sym);
  return out;
}

const limitsOf = (snaps: StoredPauSnapshot[]): LiveRateLimit[] => snaps.flatMap((s) => s.contracts.flatMap((c) => c.rateLimits ?? [])).filter((r) => r.svm);

/** The accounts a prime-level title names, among the limits held; "reserve:<mint>" for a Reserve not held; none when the title names none, or a swap or bridge not held. */
function titleKeys(title: string, limits: LiveRateLimit[], mints: Map<string, string>): string[] {
  const mint = (sym: string) => mints.get(sym.toLowerCase()) ?? null;
  const find = (type: string, m: string | null, out?: string | null) =>
    (m ? limits.filter((r) => r.svm!.type === type && r.svm!.mint === m && (out === undefined || r.svm!.output === out)) : []).map((r) => r.key);
  let m: RegExpExecArray | null;
  if ((m = /^(\w+) Reserve$/i.exec(title))) {
    const held = find("Reserve", mint(m[1]));
    return held.length || !mint(m[1]) ? held : [`reserve:${mint(m[1])}`];
  }
  if ((m = /^(\w+) For (\w+) Swap(?: Maximum)?$/i.exec(title))) return mint(m[2]) ? find("AtomicSwap", mint(m[1]), mint(m[2])) : [];
  if ((m = /^Maximum (\w+) Bridged .* Via SkyLink$/i.exec(title))) return find("LzBridge", mint(m[1]));
  if ((m = /^Maximum (\w+) Bridged .* Via Circle CCTP$/i.exec(title))) return find("CctpBridge", mint(m[1]));
  return [];
}

/** The keys of a Solana value source: its Integration account, else the accounts its title names. */
export function svmKeys(src: ValueSource, snaps: StoredPauSnapshot[], mints: Map<string, string>): InstanceKey[] {
  const integration = address(src, INTEGRATION_PARAM_RE);
  if (integration) return [{ side: "in", key: integration }];
  const title = src.name.includes(" - ") ? src.name.slice(src.name.indexOf(" - ") + 3) : src.name;
  return titleKeys(title, limitsOf(chainSnaps(snaps, src)), mints).map((key) => ({ side: "", key }));
}

/**
 * Why a Solana value has no account to compare: none when no deployment there
 * is read; a side the program does not limit, which agrees with an atlas that
 * states it unlimited ("no-limit"); else no account the title names ("no-key").
 */
export function svmAbsence(side: string, unlimited: boolean, src: ValueSource, snaps: StoredPauSnapshot[]): "no-limit" | "no-key" | null {
  if (chainSnaps(snaps, src).length === 0) return null;
  return UNLIMITED_SIDES.has(side) && unlimited ? "no-limit" : "no-key";
}
