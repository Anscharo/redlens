// Ambient types for ICD / primitive helpers used by embed-units.ts and tests.
export function buildKnownPrimitives<T extends { content?: string }>(docById: Map<string, T>): Set<string>;
export function primitiveSlugFromTitle(title: string): string;
export function primitiveDisplayName(title: string): string;
export function deriveInstanceName(
  icd: { title: string },
  primRoot: { title: string; content?: string },
  agentDoc: { title?: string } | null | undefined,
  params?: Record<string, readonly string[] | undefined>,
): string;
export function primitiveStatusFor<T extends { content?: string }>(
  primRoot: { doc_no: string },
  docByDocNo: Map<string, T>,
): string | null;
export function classifyIcd<T extends { doc_no: string; title: string }>(
  icd: { doc_no: string; title: string },
  primRoot: { doc_no: string },
  docByDocNo: Map<string, T>,
): { kind: "instance" | "invocation" | null; status: string | null };

export function buildChildrenIndex<T extends { doc_no: string }>(allDocs: T[]): Map<string, T[]>;
export function extractInstanceParams<T extends { id: string; doc_no: string; title: string; content?: string }>(
  icd: { doc_no: string },
  childrenByDocNo: Map<string, T[]>,
): Record<string, [string, string, string]>;
