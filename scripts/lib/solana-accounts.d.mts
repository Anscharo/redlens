// Type declarations for solana-accounts.mjs, so server TypeScript
// (tsconfig.server.json) can import it. Runtime stays the .mjs.

/** An account as getMultipleAccounts returns it, with a base64 data tuple. */
export interface SolanaAccount {
  owner?: string;
  executable?: boolean;
  lamports?: number;
  space?: number;
  data?: unknown;
}

export interface SolanaAccountFacts {
  accountType: "program" | "wallet" | "pda" | "mint" | "token-account" | "token-multisig" | "program-account" | "missing";
  programOwner: string | null;
  executable: boolean;
  space: number | null;
  isContract: boolean;
  isProxy: boolean;
  implementation?: string;
}

export interface FetchAccountsResult {
  accounts: Map<string, SolanaAccount | null>;
  failed: number;
  error?: string;
}

export interface FetchAccountsOptions {
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
  batch?: number;
  dataSlice?: { offset: number; length: number };
}

export const SYSTEM_PROGRAM: string;
export const TOKEN_PROGRAM: string;
export const TOKEN_2022_PROGRAM: string;
export const BPF_UPGRADEABLE_LOADER: string;
export const PROGRAM_NAMES: Record<string, string>;

export function programDataAddress(acc: SolanaAccount | null): string | null;
export function classifySolanaAccount(acc: SolanaAccount | null, address?: string): SolanaAccountFacts;
export function fetchSolanaAccounts(
  pubkeys: string[],
  options?: FetchAccountsOptions,
): Promise<FetchAccountsResult>;
export function applySolanaAccounts(
  addresses: Record<string, Record<string, unknown>>,
  options?: { names?: Record<string, string>; log?: (m: string) => void; fetchAccounts?: typeof fetchSolanaAccounts },
): Promise<{ checked: number; failed: number; byType: Record<string, number> }>;
