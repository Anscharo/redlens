// Addresses the cached verified sources declare as constants. Spells and
// controllers carry an address registry (`address internal constant USDC =
// 0x…`) naming the tokens, farms, vaults and destinations their keys are
// derived from, many of which the atlas never lists. They are key-derivation
// candidates only: a key they derive is named by its controller constant and
// arguments, never by the source's constant name, because one address can mean
// different things on two chains.
import fs from "node:fs";
import path from "node:path";

// No leading word boundary: a multi-file source is JSON inside a string, so a
// line can open right after an escaped `\n`.
const CONSTANT_RE = /address\s+(?:(?:internal|public|private)\s+)?constant\s+\w+\s*=\s*(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])/g;

/** A cached explorer entry's verified source; an unreadable file reads as none. */
function cachedSource(file: string): string {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { sourceCode?: unknown };
    return typeof j.sourceCode === "string" ? j.sourceCode : "";
  } catch {
    return "";
  }
}

/** Every address a cached source in `dir` (`<chainId>/<address>.json`) declares as an address constant, lowercased. */
export function sourceAddressConstants(dir = ".cache/etherscan"): string[] {
  const out = new Set<string>();
  for (const chain of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    for (const f of fs.readdirSync(path.join(dir, chain))) {
      for (const m of cachedSource(path.join(dir, chain, f)).matchAll(CONSTANT_RE)) out.add(m[1].toLowerCase());
    }
  }
  return [...out].sort();
}
