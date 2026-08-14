import { describe, it, expect } from "vitest";
import { timeAgo } from "./timeAgo";

const NOW = new Date("2026-08-14T12:00:00Z").getTime();
const ago = (ms: number) => timeAgo(NOW - ms, NOW);

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("timeAgo", () => {
  it("collapses anything under a minute", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(45_000)).toBe("just now");
  });

  it("counts minutes and hours, singular and plural", () => {
    expect(ago(MIN)).toBe("1 min ago");
    expect(ago(5 * MIN)).toBe("5 mins ago");
    expect(ago(59 * MIN)).toBe("59 mins ago");
    expect(ago(HOUR)).toBe("1 hour ago");
    expect(ago(3 * HOUR)).toBe("3 hours ago");
    expect(ago(23 * HOUR)).toBe("23 hours ago");
  });

  it("names yesterday, then counts days and weeks", () => {
    expect(ago(DAY)).toBe("yesterday");
    expect(ago(1.5 * DAY)).toBe("yesterday");
    expect(ago(2 * DAY)).toBe("2 days ago");
    expect(ago(6 * DAY)).toBe("6 days ago");
    expect(ago(7 * DAY)).toBe("1 week ago");
    expect(ago(20 * DAY)).toBe("2 weeks ago");
  });

  it("falls back to a date once relative age stops meaning anything", () => {
    // Day-of-month is deliberately not pinned: the fallback formats in the
    // viewer's timezone, so a fixed instant lands on either side of midnight
    // depending on where the test runs.
    expect(ago(40 * DAY)).toMatch(/^Jul \d+$/); // same year: no year shown
    expect(ago(400 * DAY)).toMatch(/^Jul \d+, 2025$/); // a different year keeps it
  });
});
