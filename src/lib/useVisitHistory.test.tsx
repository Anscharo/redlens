// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useVisitHistory, recordVisit, clearHistory } from "./visitHistory";

beforeEach(async () => {
  await clearHistory();
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
