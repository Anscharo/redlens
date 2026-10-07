// Structural stand-ins for Bun's `sql`, so a function can take the real tag or a
// plain-function fake. Type-only: importing this never loads db.ts.

export type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

/** A tag that also opens a transaction. */
export interface SqlWithTx extends SqlTag {
  begin<T>(fn: (tx: SqlTag) => Promise<T>): Promise<T>;
}
