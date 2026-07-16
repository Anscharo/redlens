// Shared collection caps — imported by both the browser UI (to show the limit
// and current count) and the Bun server (to enforce it), so the number a user
// sees always matches what the server accepts. Zero imports on purpose: this
// file is pulled into both the Vite client bundle and the server runtime.

// Max documents in a single collection. The atlas is ~10.8k docs, so this
// covers "select the entire atlas" with headroom for growth while still
// bounding a single save's insert work (a direct authenticated POST/PATCH
// can't ask the server to insert an unbounded number of item rows).
export const MAX_COLLECTION_DOCS = 20000;
