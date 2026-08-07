// Ambient types for the address-anchored chain-candidate detector
// (chain-candidates.mjs), so TS consumers get types without a rewrite.

/** A row in a chain-keyed address list that names no chain the registry knows. */
export interface OddChainRow {
  /** The cleaned row label, capped at 60 chars — the candidate chain name. */
  label: string;
  /** 1-indexed line within the doc content. */
  line: number;
  /** The known chains this row's list names — the evidence it is chain-keyed. */
  siblings: string[];
}

export function chainNamedIn(label: string | undefined | null): string | null;
export function rowLabel(prefix: string): string;
export function findChainKeyedOddRows(content: string | undefined | null): OddChainRow[];
