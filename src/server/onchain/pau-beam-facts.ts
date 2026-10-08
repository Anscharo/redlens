// BeamState as facts: one per RateLimits it manages, saying how far the
// Configurator (cBEAM) may move a limit without a spell, and one per default
// ("init") rate limit it may set a key up to. The rule is
// Configurator.setRateLimit's: a new maximum or slope may not exceed the key's
// default or max_change times its current value, any increase waits a hop, and
// a decrease is always allowed.
import type { BeamDefault, BeamLimits } from "../../lib/pau.ts";
import { exactAmount } from "../../lib/pauView.ts";
import type { OnchainFact } from "./facts.ts";
import type { PrimeAtlasRefs } from "./pau-atlas-refs.ts";
import { amount, keyMatch, keyName, perDay, scaleOf, setAt, type Base } from "./pau-fact-parts.ts";

export const BEAM_RULE =
  "Without a spell the Configurator may set a key's maximum and slope no higher than the key's default (rate-limit-default facts) " +
  "or max_change times their current values, at most one increase per key every hop_hours, and may lower them at any time. " +
  "A key with no default and no current limit can be opened only by a spell.";

const SCOPE = { contract: "this RateLimits", general: "every RateLimits this BeamState manages" } as const;

function stepFact(base: Base, beam: BeamLimits): OnchainFact {
  const values = {
    beam_state: beam.beamState,
    hop_seconds: beam.hop,
    hop_hours: beam.hop === null ? null : Number(beam.hop) / 3600,
    max_change: beam.maxChange === null ? null : exactAmount(beam.maxChange, 18),
    defaults: beam.defaults.length,
    rule: BEAM_RULE,
  };
  return {
    ...base, kind: "beam-state", name: "Configurator limits (BeamState)", name_source: null, atlas_doc_id: null,
    history_complete: base.history_complete && beam.historyComplete,
    values,
    summary: { hop_hours: values.hop_hours, max_change: values.max_change, defaults: values.defaults },
    set_at: null,
    match: { hashes: [], addresses: [base.contract, beam.beamState], docs: [] },
  };
}

function defaultFact(base: Base, d: BeamDefault, beam: BeamLimits, refs: PrimeAtlasRefs): OnchainFact {
  const key = d.key.toLowerCase();
  const { listed, ...named } = keyName(refs, base.chain, key, d.derived);
  const scale = scaleOf(d.unit, d.maxAmount);
  const values = {
    key: d.key, maximum: amount(d.maxAmount, scale.decimals), refill_per_day: perDay(d.slope, scale.decimals), ...scale,
    applies_to: SCOPE[d.scope], beam_state: beam.beamState,
    ...(d.derived ? { derivation: d.derived } : {}), ...(listed ? { listed_address: listed } : {}),
  };
  return {
    ...base, kind: "rate-limit-default", ...named,
    history_complete: base.history_complete && beam.historyComplete,
    values,
    summary: { key: d.key, maximum: values.maximum.amount, refill_per_day: values.refill_per_day.amount, ...(values.unit ? { unit: values.unit } : {}), applies_to: values.applies_to },
    set_at: d.setAt ? setAt(base.chain, d.setAt) : null,
    match: keyMatch(refs, key, [base.contract, beam.beamState], d.derived),
  };
}

export function beamFacts(base: Base, beam: BeamLimits, refs: PrimeAtlasRefs): OnchainFact[] {
  return [stepFact(base, beam), ...beam.defaults.map((d) => defaultFact(base, d, beam, refs))];
}
