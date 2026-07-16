// Shared helpers for the atlas_report builders. Graph edge/entity meta and
// source_doc_nos arrive as JSON strings on the server Indexes; these normalize
// them defensively (never throw on malformed data — return empty).

export function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// source_doc_nos is a JSON array string (current build) or a legacy comma list.
export function parseDocNos(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // fall through to legacy comma-split
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
