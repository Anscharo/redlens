// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useReportOpenTracking } from "./useReportOpenTracking";

const track = vi.fn();
vi.mock("../lib/analytics", () => ({
  track: (...a: unknown[]) => track(...a),
}));

beforeEach(() => track.mockClear());
afterEach(cleanup);

function opens(...locations: string[]) {
  const { rerender } = renderHook(({ loc }) => useReportOpenTracking(loc), {
    initialProps: { loc: locations[0] },
  });
  for (const loc of locations.slice(1)) rerender({ loc });
  return track.mock.calls.filter(([name]) => name === "report_open").map(([, props]) => props.report_id);
}

describe("useReportOpenTracking", () => {
  it("tracks entering a specific report", () => {
    expect(opens("/reports/stale-dates")).toEqual(["stale-dates"]);
  });

  it("ignores the /reports index and pages outside the reports section", () => {
    expect(opens("/reports", "/atlas", "/radar")).toEqual([]);
  });

  it("tracks a report once while the reader stays on it", () => {
    expect(opens("/reports/stale-dates", "/reports/stale-dates")).toEqual(["stale-dates"]);
  });

  it("tracks moving between reports, and returning after leaving the section", () => {
    expect(opens("/reports/stale-dates", "/reports/rewards", "/atlas", "/reports/rewards")).toEqual([
      "stale-dates",
      "rewards",
      "rewards",
    ]);
  });
});
