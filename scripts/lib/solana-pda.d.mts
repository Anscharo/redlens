// Type declarations for solana-pda.mjs, so server TypeScript
// (tsconfig.server.json) can import it. Runtime stays the .mjs.
export const ASSOCIATED_TOKEN_PROGRAM: string;
export function encodeBase58(bytes: Uint8Array): string;
export function decodeBase58(str: string): Uint8Array;
export function isOnCurve(bytes: Uint8Array): boolean;
export function findProgramAddress(
  seeds: (Uint8Array | Buffer)[],
  programId: string,
): { address: string; bump: number };
export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string): string;
