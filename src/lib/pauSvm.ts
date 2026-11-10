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
//     Asset Address), never assumed.
// A Reserve the chain does not hold is keyed "reserve:<mint>", as the snapshot
// records it unset; a swap or bridge it does not hold has no key. Pure.
import type { LiveRateLimit, StoredPauSnapshot } from "./pau.ts";
import { chainSnaps, instanceChain } from "./pauInstanceChain.ts";
import type { InstanceKey, ValueSource } from "./pauInstanceKeys.ts";
import { isSvmChain } from "./pauRegistry.ts";

/** Whether a value source is on a chain the Solana ALM program serves. */
export const isSvmSource = (src: ValueSource): boolean => {
  const chain = instanceChain(src);
  return !!chain && isSvmChain(chain);
};

/** The sides the program sets no limit on: it limits only what flows out. */
export const UNLIMITED_SIDES = new Set(["out"]);

const param = (src: ValueSource, re: RegExp) => Object.entries(src.params).find(([n]) => re.test(n))?.[1][0]?.trim() ?? null;

/** Each token symbol's mint (lowercased), from the sources that state both. */
export function svmMints(sources: ValueSource[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sources.filter(isSvmSource)) {
    const sym = param(s, /^asset supplied/i);
    const mint = param(s, /^underlying asset address$/i);
    if (sym && mint) out.set(sym.toLowerCase(), mint.toLowerCase());
  }
  return out;
}

const limitsOf = (snaps: StoredPauSnapshot[]): LiveRateLimit[] => snaps.flatMap((s) => s.contracts.flatMap((c) => c.rateLimits ?? [])).filter((r) => r.svm);
const lower = (s: string | undefined) => s?.toLowerCase();

/** The account a prime-level title names, among the limits held; "reserve:<mint>" for a Reserve not held; null when the title names none, or a swap or bridge not held. */
function titleKey(title: string, limits: LiveRateLimit[], mints: Map<string, string>): string | null {
  const mint = (sym: string) => mints.get(sym.toLowerCase()) ?? null;
  const find = (type: string, m: string | null, out?: string | null) =>
    limits.find((r) => r.svm!.type === type && lower(r.svm!.mint) === m && (out === undefined || lower(r.svm!.output) === out))?.key.toLowerCase() ?? null;
  let m: RegExpExecArray | null;
  if ((m = /^(\w+) Reserve$/i.exec(title))) return mint(m[1]) && (find("Reserve", mint(m[1])) ?? `reserve:${mint(m[1])}`);
  if ((m = /^(\w+) For (\w+) Swap(?: Maximum)?$/i.exec(title))) return mint(m[1]) && mint(m[2]) ? find("AtomicSwap", mint(m[1]), mint(m[2])) : null;
  if ((m = /^Maximum (\w+) Bridged .* Via SkyLink$/i.exec(title))) return find("LzBridge", mint(m[1]));
  if ((m = /^Maximum (\w+) Bridged .* Via Circle CCTP$/i.exec(title))) return find("CctpBridge", mint(m[1]));
  return null;
}

/** The keys of a Solana value source: its Integration account, else the account its title names. */
export function svmKeys(src: ValueSource, snaps: StoredPauSnapshot[], mints: Map<string, string>): InstanceKey[] {
  const integration = param(src, /^integration account address$/i);
  if (integration) return [{ side: "in", key: integration.toLowerCase() }];
  const title = src.name.includes(" - ") ? src.name.slice(src.name.indexOf(" - ") + 3) : src.name;
  const key = titleKey(title, limitsOf(chainSnaps(snaps, src)), mints);
  return key ? [{ side: "", key }] : [];
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
