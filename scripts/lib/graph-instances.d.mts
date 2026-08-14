// Ambient types for the ICD param walk used by embed-units.ts.
export function buildChildrenIndex<T extends { doc_no: string }>(allDocs: T[]): Map<string, T[]>;
export function extractInstanceParams(
  icd: { id: string; doc_no: string; title: string; content?: string },
  childrenByDocNo: Map<string, Array<{ id: string; doc_no: string; title: string; content?: string }>>,
): Record<string, [string, string, string]>;
