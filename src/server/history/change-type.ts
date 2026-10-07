// The atlas_history change_type vocabulary. Postgres stores content/structural/
// added/removed; the history tools and the frontend speak modified/moved/added/
// removed. Every reader and writer maps through these two functions, so no side
// can accept a name the other returns zero rows for. Imports nothing, so the
// db-mocking server tests can load it freely.

const TO_PG: Record<string, string> = { modified: "content", moved: "structural" };
const FROM_PG: Record<string, string> = { content: "modified", structural: "moved" };

/** User-facing change_type → stored value; stored values and added/removed pass through. */
export function pgType(t: string): string {
  return TO_PG[t] ?? t;
}

/** Stored change_type → user-facing value. */
export function userType(t: string): string {
  return FROM_PG[t] ?? t;
}
