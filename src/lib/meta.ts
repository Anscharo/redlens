/** Parse a JSON meta string attached to a GraphEntity or RelationEdge (.m field).
 *  Returns null for missing/empty/unparseable values rather than throwing. */
export function parseMeta<T>(m: string | null | undefined): T | null {
  if (!m) return null;
  try {
    return JSON.parse(m) as T;
  } catch {
    return null;
  }
}

/** `parseMeta` narrowed to a JSON object: null for missing/unparseable values and for
 *  JSON that is not a plain object (arrays and scalars). */
export function parseMetaObject(m: string | null | undefined): Record<string, unknown> | null {
  const parsed = parseMeta<unknown>(m);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

/** An edge's `source_doc_nos`: a JSON array string (current build) or a legacy comma
 *  list. Empty entries are dropped; missing input yields []. */
export function parseDocNos(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // fall through to the legacy comma list
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
