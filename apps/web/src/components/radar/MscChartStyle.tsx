export const CHART_STYLES = ["flow", "orbit"] as const;
export type ChartStyle = (typeof CHART_STYLES)[number];

/** The orbit / flow pills beside the overview chart's title. Fully
 *  controlled: the overview owns the choice (it lives in the URL). */
export function MscChartStyle({ value, onChange }: { value: ChartStyle; onChange: (style: ChartStyle) => void }) {
  return (
    <span role="group" aria-label="Chart style" className="flex gap-1">
      {CHART_STYLES.map((v) => (
        <button
          key={v}
          type="button"
          className="scope-pill mono text-[10px] uppercase tracking-wider px-2 py-0.5"
          data-active={value === v ? "true" : undefined}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {v}
        </button>
      ))}
    </span>
  );
}
