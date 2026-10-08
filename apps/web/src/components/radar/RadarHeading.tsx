export type HeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface RadarHeadingProps extends React.ComponentProps<"h2"> {
  /** The heading rank; deeper ranks past 6 are held at 6. */
  level: number;
}

/** A heading whose rank depends on where its list sits in the page outline.
 *  It carries no styling of its own: preflight leaves h1–h6 at the inherited
 *  size and weight, so the rank changes the outline, not the look. */
export function RadarHeading({ level, ...props }: RadarHeadingProps) {
  const Tag = `h${Math.min(Math.max(level, 2), 6)}` as "h2";
  return <Tag {...props} />;
}
