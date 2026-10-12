// The rate-limit key shapes a diamond facet's verified source proves. A facet
// declares its constants as `bytes32 internal constant _LIMIT_X =
// keccak256("LIMIT_…")` (internal, so absent from its ABI) and builds every key
// in a public pure `…RateLimitKey` getter: the bare constant, or a
// RateLimitHelpers `make…Key(_LIMIT_X, …)` that abi-encodes the constant and
// its arguments in the order the helper declares. A getter's own parameter
// order is not the encode order, so only the source says the shape. Anything
// unrecognised throws (a getter body, a helper, a rate-limit call that does
// not go through a getter): an unread source never passes for a facet with no
// keys.
import fs from "node:fs";
import path from "node:path";
import type { ArgType } from "./key-derive.ts";

export interface FacetShape {
  facet: string;
  getter: string;
  constant: string;
  types: ArgType[];
  /** The getter's parameter names, in encode order. */
  roles: string[];
}

const TYPE: Record<string, ArgType> = { address: "address", uint16: "uint", uint32: "uint", bytes32: "bytes32" };
const HELPER_RE = /function (make\w+Key)\s*\(\s*bytes32 key,([^)]*)\)\s*pure\s+returns\s*\(bytes32\)\s*\{\s*return keccak256\(abi\.encode\(key,([^)]*)\)\);\s*\}/g;
const CONSTANT_RE = /bytes32 internal constant (_LIMIT_\w+)\s*=\s*keccak256\("(LIMIT_[A-Z0-9_]+)"\);/g;
const GETTER_RE = /function (\w+RateLimitKey)\s*\(([^)]*)\)[^{;]*\{\s*return\s+([^;]+);\s*\}/g;

const fail = (facet: string, what: string): never => {
  throw new Error(`facet-source: ${facet}: ${what}`);
};
const params = (list: string) => list.split(",").map((p) => p.trim()).filter(Boolean).map((p) => p.split(/\s+/));
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

/** The source files of a verified contract: standard-JSON input (possibly double-braced) or one flat file. */
function sources(sourceCode: unknown): Record<string, string> {
  const sc = String(sourceCode ?? "");
  if (!sc.startsWith("{")) return { "main.sol": sc };
  const j = JSON.parse(sc.startsWith("{{") ? sc.slice(1, -1) : sc) as { sources?: Record<string, { content: string }> };
  return Object.fromEntries(Object.entries(j.sources ?? (j as Record<string, { content: string }>)).map(([k, v]) => [k, v.content]));
}

/** Each RateLimitHelpers helper's argument types, checked to encode in declared order. */
function helpers(facet: string, src: string): Map<string, ArgType[]> {
  const out = new Map<string, ArgType[]>();
  for (const [, name, decl, order] of src.matchAll(HELPER_RE)) {
    const ps = params(decl);
    if (order.split(",").map((s) => s.trim()).join() !== ps.map((p) => p[1]).join()) fail(facet, `${name} encodes out of declared order`);
    out.set(name, ps.map((p) => TYPE[p[0]] ?? fail(facet, `${name} takes an unknown type ${p[0]}`)));
  }
  if (out.size !== count(src, /function make\w*Key\b/g)) fail(facet, "a RateLimitHelpers function is not a plain abi.encode");
  return out;
}

function getterShape(facet: string, consts: Map<string, string>, make: Map<string, ArgType[]>, [, getter, decl, body]: string[]): FacetShape {
  const text = body.replace(/\s+/g, " ").trim();
  const bare = /^(_LIMIT_\w+)$/.exec(text);
  const call = /^(make\w+Key)\(\s*(_LIMIT_\w+)\s*,(.*)\)$/.exec(text);
  const constant = consts.get((bare ?? call)?.[bare ? 1 : 2] ?? "") ?? fail(facet, `${getter} returns ${text}`);
  if (bare) return { facet, getter, constant, types: [], roles: [] };
  const types = make.get(call![1]) ?? fail(facet, `${getter} calls ${call![1]}, not in RateLimitHelpers`);
  const roles = call![3].split(",").map((s) => s.trim());
  const ps = params(decl);
  roles.forEach((r, i) => TYPE[ps.find((p) => p[1] === r)?.[0] ?? ""] === types[i] || fail(facet, `${getter} passes ${r} where ${call![1]} takes ${types[i]}`));
  if (roles.length !== types.length) fail(facet, `${getter} passes ${roles.length} arguments to ${call![1]}`);
  return { facet, getter, constant, types, roles };
}

/** The internal function a call sits in, when it takes `ident` as a bytes32 parameter and so only forwards its caller's key. */
function forwarder(main: string, at: number, ident: string): string | null {
  const decl = [...main.slice(0, at).matchAll(/function (_\w+)\s*\(([^)]*)\)([^{]*)\{/g)].pop();
  return decl && /\b(internal|private)\b/.test(decl[3]) && params(decl[2]).some(([t, n]) => t === "bytes32" && n === ident) ? decl[1] : null;
}

/**
 * Every rate-limit read or write in the facet takes its key from a getter,
 * directly or through internal functions that forward a bytes32 key, whose
 * own calls are checked the same way.
 */
function assertKeysFromGetters(facet: string, main: string) {
  const names = new Set(["_decreaseRateLimit", "_increaseRateLimit", "_tryIncreaseRateLimit", "_rateLimitExists", "_requireRateLimitExists"]);
  for (const name of names) {
    for (const m of main.matchAll(new RegExp(`(?<!function\\s+)\\b${name}\\(\\s*(\\w+)(\\()?`, "g"))) {
      if (m[2] && /RateLimitKey$/.test(m[1])) continue;
      const via = !m[2] && forwarder(main, m.index!, m[1]);
      if (!via) fail(facet, `${name}(${m[1]}…) builds its key outside a getter`);
      names.add(via as string);
    }
  }
  if (/triggerRateLimit/.test(main)) fail(facet, "calls the RateLimits contract directly");
}

/** The key shapes one cached facet's verified source proves. */
export function parseFacet(entry: { contractName?: string; sourceCode?: unknown }): FacetShape[] {
  const facet = entry.contractName ?? fail("?", "no contractName");
  const files = sources(entry.sourceCode);
  const main = Object.entries(files).find(([k]) => k.endsWith(`/${facet}.sol`) || k === `${facet}.sol`)?.[1] ?? fail(facet, "no source file of that name");
  const make = helpers(facet, Object.entries(files).find(([k]) => k.endsWith("RateLimitHelpers.sol"))?.[1] ?? "");
  const consts = new Map([...main.matchAll(CONSTANT_RE)].map((m) => [m[1], m[2]]));
  if (consts.size !== count(main, /\bconstant\s+_LIMIT_/g)) fail(facet, "a _LIMIT_ constant is not keccak256 of a name");
  const getters = [...main.matchAll(GETTER_RE)];
  if (getters.length !== count(main, /function \w+RateLimitKey\s*\(/g)) fail(facet, "a key getter is not a single return");
  assertKeysFromGetters(facet, main);
  return getters.map((g) => getterShape(facet, consts, make, g));
}

const parsed = new Map<string, FacetShape[]>();

/** The shapes of the facet cached at `<dir>/<chainId>/<address>.json`; none when it is not cached. */
export function facetShapesAt(dir: string, chainId: number, address: string): FacetShape[] {
  const file = path.join(dir, String(chainId), `${address.toLowerCase()}.json`);
  if (!parsed.has(file)) parsed.set(file, fs.existsSync(file) ? parseFacet(JSON.parse(fs.readFileSync(file, "utf8"))) : []);
  return parsed.get(file)!;
}
