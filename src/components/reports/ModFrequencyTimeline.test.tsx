// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ModTimelineBucket } from "../../lib/modFrequencyCharts";

// Tooltip only renders `content` on hover (timer-gated) — irrelevant to this
// component's bar rendering. Stub it through, same pattern as
// ModFrequencyHistogram.test.tsx / SegmentedBar.test.tsx.
vi.mock("../Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactElement }) => cloneElement(children),
}));

import { ModFrequencyTimeline } from "./ModFrequencyTimeline";

afterEach(cleanup);

const BUCKETS: ModTimelineBucket[] = [
  { key: "2026-01", label: "Jan '26", count: 4 },
  { key: "2026-02", label: "Feb '26", count: 0 },
  { key: "2026-03", label: "Mar '26", count: 9 },
];

describe("ModFrequencyTimeline", () => {
  it("renders one bar column per bucket with its label", () => {
    render(<ModFrequencyTimeline buckets={BUCKETS} title="Semantic edits by month" />);
    expect(screen.getByText("Jan '26")).toBeInTheDocument();
    expect(screen.getByText("Feb '26")).toBeInTheDocument();
    expect(screen.getByText("Mar '26")).toBeInTheDocument();
  });

  it("renders nothing for an empty bucket list", () => {
    const { container } = render(<ModFrequencyTimeline buckets={[]} title="Semantic edits by month" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the given title", () => {
    render(<ModFrequencyTimeline buckets={BUCKETS} title="Semantic edits by week" />);
    expect(screen.getByText("Semantic edits by week")).toBeInTheDocument();
  });
});
