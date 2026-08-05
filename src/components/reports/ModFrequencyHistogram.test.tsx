// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ModCountBucket } from "../../lib/modFrequencyIndex";

// Tooltip only renders `content` on hover (timer-gated) — irrelevant to this
// component's bar rendering. Stub it through, same pattern as SegmentedBar.test.tsx.
vi.mock("../Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactElement }) => cloneElement(children),
}));

import { ModFrequencyHistogram } from "./ModFrequencyHistogram";

afterEach(cleanup);

const BUCKETS: ModCountBucket[] = [
  { count: 0, label: "0", docs: 4 },
  { count: 1, label: "1", docs: 1 },
  { count: 2, label: "2", docs: 0 },
];

describe("ModFrequencyHistogram", () => {
  it("renders one bar column per bucket with its label", () => {
    render(<ModFrequencyHistogram buckets={BUCKETS} isIncluded={() => true} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders nothing for an empty bucket list", () => {
    const { container } = render(<ModFrequencyHistogram buckets={[]} isIncluded={() => true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("dims bars the active filter excludes", () => {
    render(<ModFrequencyHistogram buckets={BUCKETS} isIncluded={(b) => b.count === 0} />);
    const bars = document.querySelectorAll(".rounded-t-sm");
    expect(bars[0]).toHaveStyle({ opacity: "1" });
    expect(bars[1]).toHaveStyle({ opacity: "0.25" });
  });
});
