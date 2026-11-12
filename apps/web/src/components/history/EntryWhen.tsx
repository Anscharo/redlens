import type { ComponentProps } from "react";

const TAN = { color: "var(--tan-3)" } as const;

export type EntryDateProps = Omit<ComponentProps<"time">, "dateTime" | "children"> & {
  /** The entry's calendar date, `YYYY-MM-DD`. */
  date: string;
};

/** The entry's date. A calendar day is a `<time>`. */
export function EntryDate({ date, ...props }: EntryDateProps) {
  return (
    <time dateTime={date} style={TAN} {...props}>
      {date}
    </time>
  );
}

export type EntryRangeProps = Omit<ComponentProps<"span">, "children"> & {
  /** The month window a severed-era birth happened in, `YYYY-MM ~ YYYY-MM`. */
  range: string;
};

/** A severed-era birth's window. A `<time>` cannot express a range. */
export function EntryRange({ range, ...props }: EntryRangeProps) {
  return (
    <span style={TAN} {...props}>
      {range}
    </span>
  );
}
