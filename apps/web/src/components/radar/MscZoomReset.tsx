/** The way back out of a zoomed MSC chart — shared by the sankey and the
 *  pies. It sits at the end of the card's title row, beside the chart-style
 *  pills, rather than over the drawing it undoes; the chart reports its zoom
 *  upward (useZoomReport) and the overview renders this. Only rendered once
 *  the chart is zoomed, so at rest the row is exactly as it was; its title
 *  names the other way out (double-click), which has no affordance of its
 *  own. Colours are tokens, never literals, so it follows every theme. */
export function MscZoomReset({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      title="Reset the zoom — or double-click the chart"
      className="mono"
      style={{
        fontSize: "10px",
        padding: "1px 8px",
        borderRadius: 4,
        border: "1px solid var(--border)",
        background: "var(--bg-deep)",
        color: "var(--tan-2)",
        cursor: "pointer",
      }}
    >
      Reset zoom
    </button>
  );
}
