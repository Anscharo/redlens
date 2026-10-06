import type { ReactNode } from "react";

// One muted or error line: the loading, failed and empty states of a list, and
// a failed action over it.
export function ListNote({ error, role, children }: { error?: boolean; role?: "alert"; children: ReactNode }) {
  return (
    <p className={error ? "mono text-xs" : "mono text-xs text-tan-3"} role={role} style={error ? { color: "var(--error-text)" } : undefined}>
      {children}
    </p>
  );
}

// Shows the list's loading, failed or empty line in place of its children.
// `empty` is the message to show when there is nothing to list, else null.
export function ListGate({
  loading,
  error,
  errorPrefix,
  empty,
  children,
}: {
  loading: boolean;
  error: string | null;
  errorPrefix: string;
  empty: string | null;
  children: ReactNode;
}) {
  if (loading) return <ListNote>Loading…</ListNote>;
  if (error) return <ListNote error>{errorPrefix}: {error}</ListNote>;
  if (empty) return <ListNote>{empty}</ListNote>;
  return <>{children}</>;
}
