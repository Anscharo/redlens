// What a deployment's previous snapshot already settled about its keys. A
// derivation is a hash preimage, so one found before still holds and is reused
// instead of hashed for again. A key no candidate named is searched again only
// when the namer's inputs changed (its constants, its candidate addresses, or
// NAMER_VERSION), since the same inputs fail the same way: without this every
// rebuild pays the whole address-pair table for the keys nothing names.
import { createHash } from "node:crypto";
import type { DerivedKey, PauSnapshot } from "../../lib/pau.ts";
import { allLimits } from "./snapshot.ts";

/** Raise when a change to the derivation code would name a key differently, so earlier names and misses are dropped. */
export const NAMER_VERSION = 1;

/** The stamp of a monolithic namer's inputs, stored as the snapshot's `keysNamedWith`. */
export function namingInputs(constants: string[], addresses: string[], words: string[] = []): string {
  const lower = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()))].sort();
  const sorted = [[...new Set(constants)].sort(), lower(addresses), lower(words)];
  return `${NAMER_VERSION}:${createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16)}`;
}

/** A diamond's stamp: its derivations are reused, its misses never are, because a facet hook's live reads also decide them. */
export const DIAMOND_INPUTS = `${NAMER_VERSION}:diamond`;

/**
 * A lookup of what `prev` settled: a derivation it holds that `keep` accepts,
 * or null for a key it left unnamed when it was named from `inputs`;
 * undefined for anything else. Nothing is settled across a NAMER_VERSION.
 */
export function settledKeys(prev: PauSnapshot | undefined, inputs: string, keep: (d: DerivedKey) => boolean): (key: string) => DerivedKey | null | undefined {
  const out = new Map<string, DerivedKey | null>();
  if (!prev?.keysNamedWith || prev.keysNamedWith.split(":")[0] !== String(NAMER_VERSION)) return () => undefined;
  for (const r of allLimits(prev)) if (r.derived && keep(r.derived)) out.set(r.key.toLowerCase(), r.derived);
  if (prev.keysNamedWith === inputs && inputs !== DIAMOND_INPUTS) {
    for (const r of allLimits(prev)) if (!r.derived && !out.has(r.key.toLowerCase())) out.set(r.key.toLowerCase(), null);
  }
  return (key) => out.get(key.toLowerCase());
}
