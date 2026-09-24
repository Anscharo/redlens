import type { ComponentProps } from "react";

// One red note in the banner's header row. Colour never carries the meaning on
// its own — each caller's wording says what is wrong.

export type PreviewWarningProps = ComponentProps<"span">;

export function PreviewWarning(props: PreviewWarningProps) {
  return <span className="mono text-xs" style={{ color: "var(--red)" }} {...props} />;
}
