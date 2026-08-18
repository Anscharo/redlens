// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useVisitLog, recordVisit, clearHistory } from "./visitHistory";

beforeEach(async () => {
  await clearHistory();
});

describe("useVisitLog", () => {
  it("hydrates and reflects newly recorded visits (incremental snapshot)", async () => {
    const { result } = renderHook(() => useVisitLog());
    expect(result.current.events).toEqual([]); // empty until the first async read
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await recordVisit({ path: "/atlas?id=a", label: "Alpha" });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0].path).toBe("/atlas?id=a");
    expect(result.current.events[0].label).toBe("Alpha");
  });

  it("picks up visits recorded while nothing was subscribed", async () => {
    // The snapshot isn't maintained with no listener (it would copy the whole
    // log on every navigation), so a later mount must re-read the store.
    const first = renderHook(() => useVisitLog());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    await recordVisit({ path: "/atlas?id=b", label: "Beta" });

    const second = renderHook(() => useVisitLog());
    await waitFor(() => expect(second.result.current.events).toHaveLength(1));
    expect(second.result.current.events[0].label).toBe("Beta");
  });
});
