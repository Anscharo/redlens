// The top of every report page: the "report" eyebrow, the registered title as
// the h1, the intro description, and an optional muted note line. Renders as a
// fragment so its pieces sit directly in ReportShell's centered column.
import type { ReactNode } from "react";

export function ReportHeader({
  title,
  description,
  note,
  noteTitle,
}: {
  title: string;
  description?: ReactNode;
  note?: ReactNode;
  noteTitle?: string;
}) {
  return (
    <>
      <p className="mono text-xs text-tan-3 mb-1">report</p>
      <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
        {title}
      </h1>
      {description && (
        <p className={`text-sm text-tan-3 ${note ? "mb-1" : "mb-5"}`}>{description}</p>
      )}
      {note && (
        <p className="mono text-xs text-tan-3 mb-4" title={noteTitle}>
          {note}
        </p>
      )}
    </>
  );
}
