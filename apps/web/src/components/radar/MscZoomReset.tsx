/** The way back out of a zoomed MSC chart — shared by the sankey and the
 *  pies. It sits at the end of the card's title row, beside the chart-style
 *  pills, rather than over the drawing it undoes; the chart reports its zoom
 *  upward (useZoomReport) and the overview renders this. Only rendered once
 *  the chart is zoomed, so at rest the row is exactly as it was; its title
 *  names the other ways out (double-click, or 0 / Escape from the keyboard),
 *  which have no affordance of their own. */
export type MscZoomResetProps = React.ComponentProps<"button"> & {
  /** Puts the chart back to its whole drawing. */
  onReset: () => void;
};

export function MscZoomReset({ onReset, ...props }: MscZoomResetProps) {
  return (
    <button
      type="button"
      onClick={onReset}
      title="Reset the zoom — or double-click the chart, or press 0"
      className="scope-pill msc-zoom-reset mono text-[10px] px-2 py-0.5"
      {...props}
    >
      Reset zoom
    </button>
  );
}
