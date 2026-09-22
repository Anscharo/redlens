/** The way back out of a zoomed MSC chart — shared by the sankey and the
 *  pies. Only rendered once the chart is zoomed, so at rest the card is
 *  exactly as it was; its title names the other way (double-click), which
 *  has no affordance of its own. Colours are tokens, never literals, so it
 *  follows every theme. */
export function MscZoomReset({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      title="Reset the zoom — or double-click the chart"
      className="mono"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
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
