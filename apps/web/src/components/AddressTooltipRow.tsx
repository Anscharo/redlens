import type { CSSProperties, ReactNode } from "react";

/** One label/value pair of the address hover card's definition list: the label
 *  on the left, its content indented in the column beside it. */
export function TipRow({ label, children, style }: { label: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <>
      <dt className="text-tan-3 whitespace-nowrap">{label}</dt>
      <dd className="min-w-0 text-tan-2" style={style}>{children}</dd>
    </>
  );
}
