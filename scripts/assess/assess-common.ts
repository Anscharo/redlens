// Shared plumbing for the assess-* scripts (OEA tasks, risk rules): JSON
// fence-stripping, uuid prefix resolution for mechanism citations, the
// transport retry loop, and prompt-building helpers. Bun-only (Bun.sleep),
// like the scripts themselves.

import type { AtlasNode } from "../../src/types";

// Breadcrumb of ancestor titles above `node`, for prompt "Context:" lines.
export function ancestorChain(node: AtlasNode, docs: Record<string, AtlasNode>): string {
  const titles: string[] = [];
  for (let p = node.parentId; p; p = docs[p]?.parentId ?? null) {
    const parent = docs[p];
    if (!parent) break;
    titles.unshift(parent.title);
  }
  return titles.join(" › ");
}

export function stripFences(raw: string): string {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  // Some models preface JSON with a sentence anyway — slice to the outermost braces.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start !== -1 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

// Accepts full uuids and unambiguous prefixes (≥8 chars) — models often echo
// the short form used in the rubric's calibration examples.
export function resolveUuid(
  cited: string,
  docIds: Set<string>,
  byPrefix: Map<string, string | null>,
): string | null {
  const c = cited.trim().toLowerCase();
  if (docIds.has(c)) return c;
  if (c.length >= 8) return byPrefix.get(c.slice(0, 8)) ?? null;
  return null;
}

export function buildPrefixIndex(docIds: Set<string>): Map<string, string | null> {
  const byPrefix = new Map<string, string | null>();
  for (const id of docIds) {
    const p = id.slice(0, 8);
    byPrefix.set(p, byPrefix.has(p) ? null : id); // null = ambiguous
  }
  return byPrefix;
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (err) {
      if (i >= attempts - 1) throw err;
      const wait = 1000 * 2 ** i;
      console.warn(`  transport error, retry in ${wait}ms: ${(err as Error).message}`);
      await Bun.sleep(wait);
    }
  }
}
