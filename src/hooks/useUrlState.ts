import { useCallback, useMemo } from "react";
import { useSearchParams } from "wouter";

export interface UrlCodec<T> {
  // Return null to omit the param entirely (default value).
  encode: (v: T) => string | null;
  decode: (raw: string | null) => T;
}

export const urlString = (def: string | null = null): UrlCodec<string | null> => ({
  encode: (v) => (v === def || v === null || v === "" ? null : v),
  decode: (raw) => raw ?? def,
});

export const urlInt = (def: number): UrlCodec<number> => ({
  encode: (v) => (v === def ? null : String(v)),
  decode: (raw) => {
    if (raw === null) return def;
    const n = Number(raw);
    return Number.isFinite(n) ? n : def;
  },
});

export const urlBool = (def: boolean): UrlCodec<boolean> => ({
  encode: (v) => (v === def ? null : v ? "1" : "0"),
  decode: (raw) => (raw === null ? def : raw === "1"),
});

// Typed enum: stores one of `allowed` (or `def` as the "no param" state).
// Decoder returns `def` for missing/invalid values so the consumer never has
// to widen the literal back to string.
export const urlEnum = <T extends string>(def: T, allowed: readonly T[]): UrlCodec<T> => ({
  encode: (v) => (v === def ? null : v),
  decode: (raw) => (raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : def),
});

// Multi-select over a typed enum: comma-separated in the URL, empty array =
// no filter (param omitted). Unknown members are dropped on decode, so a
// hand-edited URL can't smuggle a value the pill list doesn't offer.
export const urlEnumList = <T extends string>(allowed: readonly T[]): UrlCodec<T[]> => ({
  encode: (v) => (v.length ? v.join(",") : null),
  decode: (raw) =>
    raw ? raw.split(",").filter((v): v is T => (allowed as readonly string[]).includes(v)) : [],
});

// A `kind.slug` pair in one param (the report entity filters: which pill group
// the selection came from + which pill). Split on the FIRST "." only — slugs
// can contain dots — and an unrecognized kind decodes to null so a stale link
// clears the filter instead of selecting a group that no longer exists.
export const urlTagged = <K extends string>(
  kinds: readonly K[],
): UrlCodec<{ kind: K; slug: string } | null> => ({
  encode: (v) => (v === null ? null : `${v.kind}.${v.slug}`),
  decode: (raw) => {
    if (!raw) return null;
    const idx = raw.indexOf(".");
    if (idx === -1) return null;
    const kind = raw.slice(0, idx);
    return (kinds as readonly string[]).includes(kind)
      ? { kind: kind as K, slug: raw.slice(idx + 1) }
      : null;
  },
});

export const urlStringSet = (def: ReadonlySet<string> = new Set()): UrlCodec<Set<string>> => {
  const defKey = [...def].sort().join(",");
  return {
    encode: (v) => {
      const key = [...v].sort().join(",");
      if (key === defKey) return null;
      return key === "" ? "" : key;
    },
    decode: (raw) => {
      if (raw === null) return new Set(def);
      return new Set(raw ? raw.split(",").filter(Boolean) : []);
    },
  };
};

// Reads/writes a single URL search param without disturbing the others.
// Default behavior: replace history entry (filter toggles shouldn't pollute back/forward).
// Pass { push: true } when the change is a true navigation.
export function useUrlState<T>(
  key: string,
  codec: UrlCodec<T>,
  opts: { push?: boolean } = {},
): readonly [T, (next: T | ((prev: T) => T)) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = useMemo(() => codec.decode(raw), [raw, codec]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setParams(
        (prev) => {
          const np = new URLSearchParams(prev);
          const current = codec.decode(np.get(key));
          const resolved = typeof next === "function" ? (next as (p: T) => T)(current) : next;
          const encoded = codec.encode(resolved);
          if (encoded === null) np.delete(key);
          else np.set(key, encoded);
          return np;
        },
        { replace: !opts.push },
      );
    },
    [key, codec, setParams, opts.push],
  );

  return [value, set] as const;
}
