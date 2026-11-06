// What a Prime's stored controller snapshots say about the guard values an
// allocation instance states: a max slippage against the MaxSlippageSet events
// (each controller's spelling) set on one of the instance's addresses; a max
// exchange rate, written in the atlas as setMaxExchangeRate(vault, shares,
// assets), against MaxExchangeRateSet's 1e36 * assets / shares; and a "Rate
// Limit Default" against the Configurator's (BeamState's) default limit for the
// instance's key. Nothing here is read live. A value the atlas leaves to be
// specified while the chain holds one gets the "candidate" mark.
import type { AmountUnit, BeamDefault, ContractState, LiveRateLimit, PauParam, StoredPauSnapshot } from "./pau.ts";
import type { PlainCheck, PlainLine } from "./agentChecks.ts";
import { addressCheckId, NOT_INDEXED } from "./pauAddressChecks.ts";
import { chainInText, instanceChain } from "./pauInstanceChain.ts";
import { instanceKeys, listedAddresses, valueSide, type ValueSource } from "./pauInstanceKeys.ts";
import { exchangeRateText, slippageText } from "./pauParamValue.ts";
import { parseStated } from "./pauParams.ts";
import { verdict } from "./pauValueVerdict.ts";
import { formatAmount, formatPerDay, limitDecimals } from "./pauView.ts";

const UNSTATED_RE = /specified in a future/i;
const DEFAULT_RE = /^(.*?)\s*Rate\s*Limits?\s+Default\s*\/\s*(maxAmount|slope)\b/i;
const RATE_CALL_RE = /setMaxExchangeRate\(\s*\w+\s*,\s*([\d.]+(?:e\d+)?)\s*,\s*([\d.]+(?:e\d+)?)\s*\)/i;
const WAD = 10n ** 18n;

/** "1.15e6" or "0.1" as `value * 10^scale`, or null when it does not land on a whole number. */
function toRaw(text: string, scale = 0): bigint | null {
  const [mantissa, exp = "0"] = text.toLowerCase().split("e");
  const [whole, frac = ""] = mantissa.split(".");
  const shift = scale + Number(exp) - frac.length;
  return shift < 0 ? null : BigInt(whole + frac) * 10n ** BigInt(shift);
}

const paramsOn = (snaps: StoredPauSnapshot[], event: RegExp, subjects: Set<string>): PauParam[] =>
  snaps.flatMap((s) => s.contracts.flatMap((c) => c.params ?? [])).filter((p) => event.test(p.event) && subjects.has(p.subject.toLowerCase()));

/** A verdict over every stored value: all `expected` is a match, any other a mismatch; `show` says a raw value in words. */
function judge(stated: string, expected: bigint | null, raws: string[], show: (raw: string) => string, atlas: string | null): PlainCheck {
  const onchain: PlainLine[] = [...new Set(raws)].map((raw) => ({ label: "On-chain", value: show(raw) }));
  if (UNSTATED_RE.test(stated)) return { status: "candidate", head: "The atlas states no value, but the chain holds one", lines: onchain };
  if (expected === null) return { status: "unsure", head: "Can't be checked", lines: [{ text: "Atlas value not read." }, ...onchain] };
  if (raws.every((r) => BigInt(r) === expected)) return { status: "match", head: "Matches the chain", lines: onchain };
  return { status: "mismatch", head: "Differs from the chain", lines: [...onchain, { label: "Atlas", value: atlas ?? stated }] };
}

const notIndexed: PlainCheck = { status: "unsure", head: "Can't be checked", lines: [{ text: `${NOT_INDEXED[0].toUpperCase()}${NOT_INDEXED.slice(1)}.` }] };

function slippageCheck(stated: string, subjects: Set<string>, snaps: StoredPauSnapshot[]): PlainCheck {
  const raws = paramsOn(snaps, /MaxSlippage/i, subjects).map((p) => String(p.args.maxSlippage));
  if (raws.length === 0) return notIndexed;
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(stated)?.[1];
  const loss = pct ? toRaw(pct, 16) : null;
  return judge(stated, loss === null ? null : WAD - loss, raws, slippageText, pct ? `at most ${pct}% loss` : null);
}

function exchangeRateCheck(stated: string, subjects: Set<string>, snaps: StoredPauSnapshot[]): PlainCheck {
  const params = paramsOn(snaps, /MaxExchangeRate/i, subjects);
  if (params.length === 0) return notIndexed;
  const m = RATE_CALL_RE.exec(stated);
  const [shares, assets] = m ? [toRaw(m[1]), toRaw(m[2])] : [null, null];
  const expected = shares && assets !== null ? (assets * 10n ** 36n) / shares : null;
  const show = (raw: string) => exchangeRateText(raw, params[0].subjectToken?.decimals, params[0].asset) ?? raw;
  return judge(stated, expected, params.map((p) => String(p.args.maxExchangeRate)), show, expected === null ? null : show(expected.toString()));
}

/** A default limit as a held limit, so the value verdict reads it in the same units. */
const asLimit = (d: BeamDefault, unit: AmountUnit | undefined): LiveRateLimit & { data: NonNullable<LiveRateLimit["data"]> } => ({
  key: d.key, configured: { maxAmount: d.maxAmount, slope: d.slope }, setAt: d.setAt ?? { block: 0, time: "", tx: "" }, changes: 0, available: null,
  data: { maxAmount: d.maxAmount, slope: d.slope, lastAmount: "0", lastUpdated: "0" }, ...(unit ? { unit } : {}),
});

/** A default's unit: its own, else the held limit's for the same key. */
const unitOf = (d: BeamDefault, beams: ContractState[]) =>
  d.unit ?? beams.flatMap((c) => c.rateLimits ?? []).find((r) => r.key.toLowerCase() === d.key.toLowerCase())?.unit;

function defaultValue(d: BeamDefault, unit: AmountUnit | undefined, field: "maxAmount" | "slope"): string {
  const dec = limitDecimals(unit, d.maxAmount);
  return field === "maxAmount" ? formatAmount(d.maxAmount, dec) : `${formatPerDay(d.slope, dec)} per day`;
}

/** The Configurator's default limit for the instance's keys on that side, judged as a held limit would be. */
function defaultCheck(src: ValueSource, name: string, stated: string, snaps: StoredPauSnapshot[]): PlainCheck {
  const [, side, field] = DEFAULT_RE.exec(name) as unknown as [string, string, "maxAmount" | "slope"];
  const keys = new Set(instanceKeys(src, snaps).filter((k) => !k.side || k.side === valueSide(side)).map((k) => k.key));
  const beams = snaps.flatMap((s) => s.contracts.filter((c) => c.beam));
  if (beams.length === 0) return notIndexed;
  const found = beams.flatMap((c) => c.beam!.defaults.filter((d) => keys.has(d.key.toLowerCase())));
  if (found.length === 0) return { status: "not-set", head: "Not set on the contract", lines: [{ text: "No Configurator default limit is set for this instance's key." }] };
  const lines: PlainLine[] = found.map((d) => ({ label: "On-chain default", value: defaultValue(d, unitOf(d, beams), field) }));
  if (UNSTATED_RE.test(stated)) return { status: "candidate", head: "The atlas states no value, but the chain holds one", lines };
  const s = parseStated(stated);
  const agrees = (d: BeamDefault) => !!s && s.kind !== "none" && verdict(s, field, asLimit(d, unitOf(d, beams))) === "match";
  return found.every(agrees) ? { status: "match", head: "Matches the chain", lines } : { status: "mismatch", head: "Differs from the chain", lines: [...lines, { label: "Atlas", value: stated }] };
}

/**
 * What an instance's guards are set on: its Uniswap v4 pool id where it states
 * one (a v4 guard is keyed by the pool id, and an address the instance also
 * lists can carry another integration's guard), else its listed addresses.
 */
function subjectsOf(src: ValueSource): Set<string> {
  const poolId = Object.entries(src.params).find(([n, [v]]) => /pool\s*id/i.test(n) && /^0x[0-9a-fA-F]{64}$/.test(v.trim()));
  return new Set(poolId ? [poolId[1][0].trim().toLowerCase()] : listedAddresses(src));
}

function paramCheck(src: ValueSource, name: string, value: string, all: StoredPauSnapshot[]): PlainCheck | null {
  const chain = chainInText(name) ?? instanceChain(src);
  const snaps = chain ? all.filter((s) => s.chain === chain) : [];
  const subjects = subjectsOf(src);
  if (/slippage/i.test(name)) return snaps.length ? slippageCheck(value, subjects, snaps) : notIndexed;
  if (/exchange\s*rate/i.test(name)) return snaps.length ? exchangeRateCheck(value, subjects, snaps) : notIndexed;
  if (DEFAULT_RE.test(name)) return snaps.length ? defaultCheck(src, name, value, all) : notIndexed;
  return null;
}

/** Every max slippage, max exchange rate and default limit an instance states, against the stored controller snapshots. */
export function checkGuardParams(sources: ValueSource[], snaps: StoredPauSnapshot[]): Map<string, PlainCheck> {
  const out = new Map<string, PlainCheck>();
  for (const src of sources) {
    if (!src.docId || src.constant) continue;
    for (const [name, [value]] of Object.entries(src.params)) {
      const c = paramCheck(src, name, value, snaps);
      if (c) out.set(addressCheckId(src.docId, name), c);
    }
  }
  return out;
}
