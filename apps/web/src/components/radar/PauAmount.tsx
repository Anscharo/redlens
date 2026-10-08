import { formatAmount } from "../../lib/pau";

/** A compact on-chain amount with its token's symbol, when the worker read one. */
export function PauAmount({ raw, dec, symbol }: { raw: string; dec: number; symbol?: string | null }) {
  return (
    <>
      {formatAmount(raw, dec)}
      {symbol && <span style={{ color: "var(--tan-3)" }}> {symbol}</span>}
    </>
  );
}
