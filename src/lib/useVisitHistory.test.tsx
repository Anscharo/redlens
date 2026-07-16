// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useVisitHistory, recordVisit, getEvents, clearHistory } from "./visitHistory";

beforeEach(async () => {
  await clearHistory();
  window.history.pushState({}, "", "/"); // reset any preview URL between tests
});

describe("useVisitHistory", () => {
  it("hydrates and reflects newly recorded visits", async () => {
    const { result } = renderHook(() => useVisitHistory());
    expect(result.current).toEqual([]); // empty until the first async read

    await recordVisit({ path: "/atlas?id=a", label: "Alpha" });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].path).toBe("/atlas?id=a");
    expect(result.current[0].label).toBe("Alpha");
  });
});

describe("recordVisit preview separation", () => {
  it("prefixes the stored path with the current /preview/<id> router base", async () => {
    // Simulate being on an atlas-PR preview page (same signal main.tsx routes on).
    window.history.pushState({}, "", "/preview/42/atlas?id=a");
    await recordVisit({ path: "/atlas?id=a", label: "Alpha" }); // capture sites pass base-relative

    const events = await getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].path).toBe("/preview/42/atlas?id=a"); // prefixed, won't collide with live
  });
});
