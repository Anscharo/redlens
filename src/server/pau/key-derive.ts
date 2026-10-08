// Names for rate-limit keys the atlas never writes out as a hash. A controller
// derives each key from one of its LIMIT_* constants (keccak256 of the name),
// alone or abi-encoded with what it limits: an asset or pool address, a CCTP
// domain or LayerZero endpoint id, or an (asset, destination) pair. Hashing
// every constant against every candidate recovers the name and its arguments.
import fs from "node:fs";
import path from "node:path";
import { encodeAbiParameters, keccak256, toHex, type AbiParameter } from "viem";
import type { DerivedKey } from "../../lib/pau.ts";

type Arg = "address" | "id";
interface Shape {
  args: Arg[];
  /** Constants this shape applies to; every constant when absent. */
  only?: RegExp;
}

// Cheapest first: the costly shapes are hashed only once a key is still unnamed.
const SHAPES: Shape[] = [
  { args: [] },
  { args: ["address"] },
  { args: ["id"] },
  { args: ["address", "address"], only: /^LIMIT_ASSET_TRANSFER$/ },
  { args: ["address", "id"], only: /^LIMIT_(LAYERZERO|CENTRIFUGE)_TRANSFER$/ },
];

/** CCTP domains, Centrifuge ids and LayerZero v2 endpoint ids (30101 Ethereum onward). */
const IDS = [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 321 }, (_, i) => 30100 + i)];
const ABI_TYPE: Record<Arg, AbiParameter> = { address: { type: "address" }, id: { type: "uint32" } };

function combos(args: Arg[], addresses: string[]): (string | number)[][] {
  return args.reduce<(string | number)[][]>((acc, a) => acc.flatMap((xs) => (a === "address" ? addresses : IDS).map((v) => [...xs, v])), [[]]);
}

/**
 * A lookup from key to the constant and arguments that derive it, or null.
 * Shapes are hashed lazily, so a deployment whose keys are all found early
 * never pays for the address pairs.
 */
export function keyDeriver(constants: string[], addresses: string[]): (key: string) => DerivedKey | null {
  const found = new Map<string, DerivedKey>();
  const addrs = [...new Set(addresses.map((a) => a.toLowerCase()))];
  let next = 0;
  const fill = (s: Shape) => {
    for (const constant of constants.filter((c) => !s.only || s.only.test(c))) {
      const base = keccak256(toHex(constant));
      if (s.args.length === 0) found.set(base, { constant, args: [] });
      else for (const args of combos(s.args, addrs)) {
        const key = keccak256(encodeAbiParameters([{ type: "bytes32" }, ...s.args.map((a) => ABI_TYPE[a])], [base, ...args]));
        found.set(key, { constant, args: args.map(String) });
      }
    }
  };
  return (key) => {
    const k = key.toLowerCase();
    while (!found.has(k) && next < SHAPES.length) fill(SHAPES[next++]);
    return found.get(k) ?? null;
  };
}

type AbiItem = { type?: string; name?: string; inputs?: unknown[] };

/** A cached explorer entry's ABI; an unreadable or truncated cache file reads as none. */
function cachedAbi(file: string): AbiItem[] {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { abi?: unknown };
    const abi = typeof j.abi === "string" ? JSON.parse(j.abi) : j.abi;
    return Array.isArray(abi) ? abi : [];
  } catch {
    return [];
  }
}

/** Every zero-argument LIMIT_* view in the cached contract ABIs. */
export function limitConstants(dir = ".cache/etherscan"): string[] {
  const names = new Set<string>();
  for (const chain of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    for (const f of fs.readdirSync(path.join(dir, chain))) {
      for (const x of cachedAbi(path.join(dir, chain, f))) if (x.type === "function" && /^LIMIT_/.test(x.name ?? "") && !x.inputs?.length) names.add(x.name!);
    }
  }
  return [...names].sort();
}

const ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;

/** Addresses the keys may be derived from: every one in the address artifacts that exist, plus the given extras. */
export function candidateAddresses(files: string[], extra: unknown): string[] {
  const out = new Set<string>();
  for (const f of files.filter((x) => fs.existsSync(x))) for (const a of Object.keys(JSON.parse(fs.readFileSync(f, "utf8")))) out.add(a);
  for (const m of JSON.stringify(extra).matchAll(ADDRESS_RE)) out.add(m[0]);
  return [...out].filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
}
