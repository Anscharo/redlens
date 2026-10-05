// Type declarations for worker-drift.mjs, so tests can import it. Runtime stays worker-drift.mjs.
export interface DriftState {
  upstreamSha: string | null;
  syncState: string | null;
  staleCount: number;
  structural: { healthy: boolean; reasons: string[]; currentDocs?: number; currentAddresses?: number };
  artifactsPublished: boolean;
}
export function readDriftState(db: unknown, readSha: () => Promise<string | null>): Promise<DriftState>;
export function logRebuildReason(state: Pick<DriftState, "upstreamSha" | "syncState" | "staleCount">): void;
