// A Postgres timestamp as an ISO string. Bun decodes timestamptz to a Date, a
// text column or a fake db gives a string; anything unparseable is null.
export function toIso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
