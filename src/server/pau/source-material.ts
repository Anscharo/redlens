// What a verified Solidity source says that names rate-limit keys: the LIMIT_*
// names it hashes (`keccak256("LIMIT_UNISWAP_V4_DEPOSIT")`; a library binds
// that to a local name such as LIMIT_DEPOSIT, so the string is what counts),
// its `address … constant`s (Spark's spells carry an address registry naming L2
// tokens, farms and transfer destinations the atlas never lists) and its
// `bytes32 … constant`s (a Uniswap v4 pool id). They are key-derivation
// candidates only: a key they derive is named by its controller constant and
// arguments, never by the source's constant name, because one address can mean
// different things on two chains. `spells` are the address constants named as
// a spell or payload (`SPARK_SPELL`), which the spell-source sync reads next.
import { EVM_ADDRESS_BODY_SRC } from "../../lib/patterns.ts";
import { cachedEntries } from "./key-derive.ts";

export interface SourceMaterial {
  names: string[];
  addresses: string[];
  words: string[];
  spells: string[];
}

// No leading word boundary: a multi-file source is JSON inside a string, so a
// line can open right after an escaped `\n`, and a quote can be escaped too.
const VISIBILITY = String.raw`(?:(?:internal|public|private)\s+)?constant\s+`;
const NAME_RE = /keccak256\(\s*\\?"(LIMIT_[A-Z0-9_]+)\\?"\s*\)/g;
const ADDRESS_RE = new RegExp(String.raw`address\s+${VISIBILITY}(\w+)\s*=\s*(${EVM_ADDRESS_BODY_SRC})(?![0-9a-fA-F])`, "g");
const WORD_RE = new RegExp(String.raw`bytes32\s+${VISIBILITY}\w+\s*=\s*(0x[0-9a-fA-F]{64})(?![0-9a-fA-F])`, "g");
const SPELL_NAME = /(?:SPELL|PAYLOAD)/;

/** Raise when materialOf would read a source differently, so every stored spell is read again (spell-sources.ts). */
export const MATERIAL_VERSION = 1;

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

/** The naming material of one source, addresses and words lowercased. */
export function materialOf(source: string): SourceMaterial {
  const addresses = [...source.matchAll(ADDRESS_RE)];
  return {
    names: sorted([...source.matchAll(NAME_RE)].map((m) => m[1])),
    addresses: sorted(addresses.map((m) => m[2].toLowerCase())),
    words: sorted([...source.matchAll(WORD_RE)].map((m) => m[1].toLowerCase())),
    spells: sorted(addresses.filter((m) => SPELL_NAME.test(m[1])).map((m) => m[2].toLowerCase())),
  };
}

/** Several sources' material as one. */
export function mergeMaterial(ms: SourceMaterial[]): SourceMaterial {
  return {
    names: sorted(ms.flatMap((m) => m.names)),
    addresses: sorted(ms.flatMap((m) => m.addresses)),
    words: sorted(ms.flatMap((m) => m.words)),
    spells: sorted(ms.flatMap((m) => m.spells)),
  };
}

/** The material of every verified source in the explorer cache in `dir`. */
export function cachedSourceMaterial(dir: string): SourceMaterial {
  return mergeMaterial(cachedEntries(dir).map((e) => materialOf(typeof e.sourceCode === "string" ? e.sourceCode : "")));
}
