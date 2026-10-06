// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getCollection: vi.fn(),
  replace: vi.fn(),
  setActiveCollectionId: vi.fn(),
  setActiveCollectionName: vi.fn(),
  navigate: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../lib/conversationsApi", () => ({ getConversationCollection: mocks.getCollection }));
vi.mock("../lib/selection", () => ({
  useSelection: () => ({
    replace: mocks.replace,
    setActiveCollectionId: mocks.setActiveCollectionId,
    setActiveCollectionName: mocks.setActiveCollectionName,
  }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/conversations", mocks.navigate] }));
vi.mock("../lib/analytics", () => ({ track: mocks.track }));

import { useOpenConversationCollection } from "./useOpenConversationCollection";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useOpenConversationCollection", () => {
  it("loads the cited docs as an unowned selection and opens the reader's selected-only view", async () => {
    mocks.getCollection.mockResolvedValue({ id: "c1", name: "Spark rates", ids: ["d1", "d2"], auto: true });
    const { result } = renderHook(() => useOpenConversationCollection());
    await act(() => result.current.open("c1"));

    expect(mocks.getCollection).toHaveBeenCalledWith("c1");
    expect(mocks.replace).toHaveBeenCalledWith(["d1", "d2"]);
    // Cleared so Save can never "Update" a collection the conversation owns.
    expect(mocks.setActiveCollectionId).toHaveBeenCalledWith(null);
    expect(mocks.setActiveCollectionName).toHaveBeenCalledWith("Spark rates");
    expect(mocks.navigate).toHaveBeenCalledWith("/atlas?subset=selected");
    expect(mocks.track).toHaveBeenCalledWith("conversation_collection_open", { id: "c1", count: 2 });
    expect(result.current.failed).toBe(false);
  });

  it("leaves the selection alone and reports failure when the read fails, then clears it on retry", async () => {
    mocks.getCollection.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useOpenConversationCollection());
    await act(() => result.current.open("c1"));
    expect(result.current.failed).toBe(true);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    mocks.getCollection.mockResolvedValue({ id: "c1", name: "x", ids: ["d1"], auto: true });
    await act(() => result.current.open("c1"));
    expect(result.current.failed).toBe(false);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });
});
