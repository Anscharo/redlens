// Every 64-hex value the atlas states, typed by how its own document introduces
// it. RateLimitIDs, transaction hashes and pool IDs are all written in the same
// backticked `0x…` form, so the words beside the value are the only thing that
// tells them apart.
import type { AtlasNode } from "../types";

export type AtlasHashKind = "rate-limit-id" | "transaction" | "pool-id";

export interface AtlasHashRef {
  hash: string;
  kind: AtlasHashKind;
  /** What the hash is, in words: "rate limit ID", "transaction hash", "Morpho market ID". */
  kindLabel: string;
  /** The stating document's title ("Aggregate CCTP Rate Limit ID", "ETH/USDC 86% LLTV Pool"). */
  title: string;
  /** The instance the document belongs to, without " Instance Configuration Document", or null. */
  instance: string | null;
  docId: string;
}

/** A title or param name that introduces a RateLimitID ("Inflow RateLimitID", "Rate Limit IDs / deposit"). */
export const RATE_LIMIT_ID_RE = /Rate\s*Limit\s*IDs?\b/i;

const HASH_RE = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const KINDS: [AtlasHashKind, RegExp][] = [
  ["rate-limit-id", RATE_LIMIT_ID_RE],
  ["transaction", /Transaction\s+Hash/i],
  ["pool-id", /Pool\s+ID/i],
];
const ICD_SUFFIX_RE = /\s+Instance Configuration Document$/i;

/** The kind the words before a hash on its line give it, else the kind its document's title gives it. */
export function hashKind(title: string, lineBefore: string): AtlasHashKind | null {
  for (const [kind, re] of KINDS) if (re.test(lineBefore)) return kind;
  for (const [kind, re] of KINDS) if (re.test(title)) return kind;
  return null;
}

function kindLabel(kind: AtlasHashKind, instance: string | null): string {
  if (kind === "rate-limit-id") return "rate limit ID";
  if (kind === "transaction") return "transaction hash";
  if (/morpho/i.test(instance ?? "")) return "Morpho market ID";
  if (/uniswap v4/i.test(instance ?? "")) return "Uniswap v4 pool ID";
  return "pool ID";
}

/** The nearest ancestor that is an instance's configuration document, by doc number. */
function instanceOf(doc: AtlasNode, byDocNo: Map<string, AtlasNode>): string | null {
  const parts = doc.doc_no.split(".");
  for (let i = parts.length; i > 0; i--) {
    const title = byDocNo.get(parts.slice(0, i).join("."))?.title;
    if (title && ICD_SUFFIX_RE.test(title)) return title.replace(ICD_SUFFIX_RE, "");
  }
  return null;
}

/**
 * Every hash in the docs, lowercased, with each document that states it. A hash
 * whose document gives it no kind is left out, so a new kind of hash shows up
 * as a gap in `unclassifiedHashes` rather than as a wrong name.
 */
export function atlasHashIndex(docs: Iterable<AtlasNode>): Map<string, AtlasHashRef[]> {
  const all = [...docs];
  const byDocNo = new Map(all.map((d) => [d.doc_no, d]));
  const index = new Map<string, AtlasHashRef[]>();
  for (const doc of all) {
    const text = doc.content ?? "";
    for (const m of text.matchAll(HASH_RE)) {
      const kind = hashKind(doc.title, text.slice(text.lastIndexOf("\n", m.index) + 1, m.index));
      if (!kind) continue;
      const hash = m[0].toLowerCase();
      const instance = instanceOf(doc, byDocNo);
      const ref = { hash, kind, kindLabel: kindLabel(kind, instance), title: doc.title, instance, docId: doc.id };
      index.set(hash, [...(index.get(hash) ?? []), ref]);
    }
  }
  return index;
}

/** Hashes the atlas states that `atlasHashIndex` could not type. */
export function unclassifiedHashes(docs: Iterable<AtlasNode>, index: Map<string, AtlasHashRef[]>): string[] {
  const out = new Set<string>();
  for (const doc of docs) for (const m of (doc.content ?? "").matchAll(HASH_RE)) if (!index.has(m[0].toLowerCase())) out.add(m[0].toLowerCase());
  return [...out];
}
