// The tables a PR environment seeds once from the development database
// (copy.ts). The source's reader role needs SELECT on each (scripts/CLAUDE.md,
// "PR environments"). One entry per table; a new table is one appended line.
//
// An entry without `merge` is replaced wholesale. An entry with `merge` keeps
// this environment's own rows, which its own sync writes, and overwrites only
// the listed columns on the rows whose `key` matches a source row.

export interface CopyTable {
  table: string;
  merge?: { key: string[]; columns: string[] };
}

export const PR_ENV_COPY_TABLES: CopyTable[] = [
  { table: "pau_state" },
  { table: "pau_events" },
  { table: "pau_cursor" },
  { table: "pau_rpc_cursor" },
  { table: "chain_state" },
  // Balances, the bytecode check and the joined contract state live on the
  // address rows sync.ts owns, so they are copied onto those rows.
  {
    table: "atlas_addresses",
    merge: { key: ["address", "chain"], columns: ["balances", "balances_checked_at", "has_code", "chain_state"] },
  },
];
