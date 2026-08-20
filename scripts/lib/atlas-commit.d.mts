export const UNKNOWN_ATLAS_COMMIT: "unknown";
export function isUsableAtlasCommit(value: unknown): value is string;
export function pickAtlasCommit(...candidates: unknown[]): string | null;
export function stampAtlasCommit(...candidates: unknown[]): string;
export function gitHead(cwd: string): string | null;
