// Ambient types so src/server/retrieval/embed-units.ts can import isICD
// without a rewrite of graph-patterns.mjs.
export function isICD(d: { title: string; content?: string }): boolean;
export function isICDLocation(d: { title: string; content?: string }): boolean;
