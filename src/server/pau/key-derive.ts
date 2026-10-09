// Names for rate-limit keys the atlas never writes out as a hash. A controller
// derives each key from one of its LIMIT_* constants (keccak256 of the name),
// alone or abi-encoded with what it limits: an asset or pool address, a CCTP
// domain or LayerZero endpoint id, or an (asset, destination) pair. Hashing
// every constant against every candidate recovers the name and its arguments.
// The hashing engine (shapeDeriver) also hashes the diamond facets' shapes
// (diamond-derive.ts); the monolithic shapes are declared here.
import fs from "node:fs";
import path from "node:path";
import { keccak256, toHex, type Hex } from "viem";
import type { DerivedKey } from "../../lib/pau.ts";

/** How one argument is abi-encoded: an address, an unsigned integer (a CCTP domain, an endpoint id), or a bytes32. */
export type ArgType = "address" | "uint" | "bytes32";

/**
 * One way a key is encoded: keccak256(abi.encode(keccak256(constant), ...args)).
 * `tuples` are argument lists to hash as given (values read from the chain);
 * besides them, a shape of at most two address or integer arguments is
 * enumerated over the candidate addresses and IDS.
 */
export interface KeyShape {
  constant: string;
  types: ArgType[];
  name: (args: string[]) => DerivedKey;
  tuples?: string[][];
}

/** CCTP domains, Centrifuge ids and LayerZero v2 endpoint ids (30101 Ethereum onward). */
const IDS = [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 321 }, (_, i) => 30100 + i)].map(String);

// Every abi.encode argument is one 32-byte word, so a uint16 and a uint32 encode alike.
const word = (t: ArgType, v: string) => (t === "uint" ? BigInt(v).toString(16) : v.slice(2).toLowerCase()).padStart(64, "0");

const enumerable = (types: ArgType[]) => types.length <= 2 && !types.includes("bytes32");

function argLists(s: KeyShape, addresses: string[]): string[][] {
  const listed = enumerable(s.types) ? s.types.reduce<string[][]>((acc, t) => acc.flatMap((xs) => (t === "address" ? addresses : IDS).map((v) => [...xs, v])), [[]]) : [];
  return [...(s.tuples ?? []), ...listed];
}

const cost = (s: KeyShape, n: number) => (s.tuples?.length ?? 0) + (enumerable(s.types) ? s.types.reduce((p, t) => p * (t === "address" ? n : IDS.length), 1) : 0);

/**
 * A lookup from key to the derivation that reproduces it, or null. Shapes are
 * hashed lazily, cheapest first, so a deployment whose keys are all found
 * early never pays for the address pairs.
 */
export function shapeDeriver(shapes: KeyShape[], addresses: string[]): (key: string) => DerivedKey | null {
  const found = new Map<string, DerivedKey>();
  const addrs = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const queue = [...shapes].sort((a, b) => cost(a, addrs.length) - cost(b, addrs.length));
  const fill = (s: KeyShape) => {
    const base = keccak256(toHex(s.constant));
    for (const args of argLists(s, addrs)) {
      const key = s.types.length ? keccak256(`${base}${s.types.map((t, i) => word(t, args[i])).join("")}` as Hex) : base;
      if (!found.has(key)) found.set(key, s.name(args));
    }
  };
  let next = 0;
  return (key) => {
    const k = key.toLowerCase();
    while (!found.has(k) && next < queue.length) fill(queue[next++]);
    return found.get(k) ?? null;
  };
}

/**
 * The monolithic controllers' shapes: every constant bare, with one address
 * and with one id; makeAssetDestinationKey pairs, identified by the second
 * argument, for an asset transfer (asset, destination) and for UniswapV3Lib
 * (token, pool); and (address, id) for LayerZero and Centrifuge transfers.
 */
function monolithicShapes(constant: string): KeyShape[] {
  const plain = (types: ArgType[]): KeyShape => ({ constant, types, name: (args) => ({ constant, args }) });
  const shapes = [plain([]), plain(["address"]), plain(["uint"])];
  if (/^LIMIT_(ASSET_TRANSFER|UNISWAP_V3_\w+)$/.test(constant)) shapes.push({ constant, types: ["address", "address"], name: (args) => ({ constant, args, via: args[1] }) });
  if (/^LIMIT_(LAYERZERO|CENTRIFUGE)_TRANSFER$/.test(constant)) shapes.push(plain(["address", "uint"]));
  return shapes;
}

/** A lookup from key to the monolithic constant and arguments that derive it, or null. */
export function keyDeriver(constants: string[], addresses: string[]): (key: string) => DerivedKey | null {
  return shapeDeriver(constants.flatMap(monolithicShapes), addresses);
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

/** An address artifact's addresses: addresses.json is keyed by address, addresses.atlas.json nests them under `addresses`. */
const addressKeys = (j: { addresses?: unknown }) => Object.keys(j.addresses && typeof j.addresses === "object" ? j.addresses : j);

/** Addresses the keys may be derived from: every one in the address artifacts that exist, plus the given extras. */
export function candidateAddresses(files: string[], extra: unknown): string[] {
  const out = new Set<string>();
  for (const f of files.filter((x) => fs.existsSync(x))) for (const a of addressKeys(JSON.parse(fs.readFileSync(f, "utf8")))) out.add(a);
  for (const m of JSON.stringify(extra).matchAll(ADDRESS_RE)) out.add(m[0]);
  return [...out].filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
}
