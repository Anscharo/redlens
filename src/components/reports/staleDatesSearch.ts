import type { DateClaim } from "@/lib/staleDates";
import type { SearchField } from "@/lib/reportFilter";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2026-07-31" → "July 2026", so month-name queries ("july", "july 2026",
// "jul") match the row through its month POSITION only — never through a
// same-numbered day like 2026-02-07. Rendered as a hidden field: the row
// shows the ISO date, and the aside explains a month-name match.
export const monthLabel = (iso: string): string => {
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${iso.slice(0, 4)}` : "";
};

// Header-box text filter: date (ISO + the raw atlas text + a derived
// month-name form), doc title/number, snippet prose, and the "handoff"
// badge word for transition rows.
export const staleSearchFields = (c: DateClaim): SearchField[] => [
  { label: "date", value: c.dateISO },
  { label: "month", value: monthLabel(c.dateISO), hidden: true },
  { label: "date text", value: c.raw },
  { label: "title", value: c.title },
  { label: "doc no", value: c.docNo },
  { label: "context", value: c.context },
  { label: "handoff", value: c.transition ? "handoff" : "" },
];

export const STALE_SEARCHES = "date (ISO + month name) · date text · title · doc no · snippet text";
