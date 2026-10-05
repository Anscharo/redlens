// Steps cell of a Processes report row: the detected step count, or a dash
// when the shape gives no countable steps.
import type { ProcessRow as ProcessRowData } from "@/lib/processesIndex";

export function ProcessStepsCell({ count, shape }: { count: number | null; shape: ProcessRowData["shape"] }) {
  if (count === null) {
    return (
      <span className="mono text-[10px] text-tan-3" title="step count not auto-detectable">
        —
      </span>
    );
  }
  return (
    <span className="mono text-[10px] text-tan-3">
      {count} {shape === "inline" ? "inline " : ""}step{count === 1 ? "" : "s"}
    </span>
  );
}
