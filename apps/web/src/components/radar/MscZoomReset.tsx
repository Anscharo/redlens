/** The way back out of a zoomed MSC chart. Only rendered once the chart is
 *  zoomed, so at rest the card is exactly as it was; its title names the
 *  other way (double-click), which has no affordance of its own. Colours are
 *  tokens, never literals, so it follows every theme.
 *
 *  MscFlowZoomReset is its twin, added for the flow chart at the same time
 *  by a different hand; they are the same control and should collapse into
 *  this one the moment both are in the same tree. */
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
