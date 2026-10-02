// The body slot of a report page: a loading line until the data arrives, then
// the shared "no rows match" line (when the filters empty the page) above the
// report's own content.
import type { ReactNode } from "react";
import { NoRowsMatch } from "./NoRowsMatch";

export function ReportBody({
  loading,
  noRows,
  query,
  children,
}: {
  loading: boolean;
  noRows: boolean;
  query: string;
  children?: ReactNode;
}) {
  if (loading) return <p className="mono text-xs text-tan-3">Loading…</p>;
  return (
    <>
      {noRows && <NoRowsMatch query={query} />}
      {children}
    </>
  );
}
