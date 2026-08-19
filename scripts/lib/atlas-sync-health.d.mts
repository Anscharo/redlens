export interface StructuralSnapshot {
  syncSha: string | null;
  totalDocs: number;
  currentDocs: number;
  docsWithAddressRefs: number;
  totalAddresses: number;
  currentAddresses: number;
}

export interface StructuralAssessment extends StructuralSnapshot {
  healthy: boolean;
  reasons: string[];
}

export type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<Record<string, unknown>>>;

export function assessStructuralSnapshot(snapshot: StructuralSnapshot): StructuralAssessment;
export function inspectStructuralSnapshot(db: SqlTag, syncSha: string | null): Promise<StructuralAssessment>;
