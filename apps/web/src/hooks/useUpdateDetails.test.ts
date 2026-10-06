// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";

const fetchHealthFresh = vi.fn();
vi.mock("../lib/health", () => ({ fetchHealthFresh: (...a: unknown[]) => fetchHealthFresh(...a) }));

import { useUpdateDetails, codeUpdateLine, atlasUpdateLine } from "./useUpdateDetails";

beforeEach(() => {
  fetchHealthFresh.mockReset();
  fetchHealthFresh.mockResolvedValue(null);
});
afterEach(() => cleanup());

// vitest.config.ts stubs __COMMIT_HASH__ to "test".
describe("update detail lines", () => {
  it("names the code versions on both sides of the update", () => {
    expect(codeUpdateLine("test", "f".repeat(40))).toBe("Code: test → fffffff");
  });
  it("says so when the commit is unchanged (new assets only)", () => {
    expect(codeUpdateLine("test", "test" + "0".repeat(36))).toContain("same commit");
  });
  it("falls back to a generic line without a server commit", () => {
    expect(codeUpdateLine("test", null)).toBe("Code: a newer build is available");
    expect(codeUpdateLine("test", "dev")).toBe("Code: a newer build is available");
  });
  it("names the atlas shas, or falls back", () => {
    expect(atlasUpdateLine("a".repeat(40), "b".repeat(40))).toBe("Atlas docs: aaaaaaa → bbbbbbb");
    expect(atlasUpdateLine(null, "b")).toBe("Atlas docs: content has been updated");
  });
});

describe("useUpdateDetails", () => {
  it("does not fetch while nothing is stale", () => {
    renderHook(() => useUpdateDetails(false, false, "a".repeat(40)));
    expect(fetchHealthFresh).not.toHaveBeenCalled();
  });

  it("fills in the from → to versions from a fresh health read", async () => {
    fetchHealthFresh.mockResolvedValue({ status: "ok", atlas_sha: "b".repeat(40), docs: 1, app_commit: "c".repeat(40) });
    const { result } = renderHook(() => useUpdateDetails(true, true, "a".repeat(40)));
    await waitFor(() => expect(result.current.codeTitle).toContain("test → ccccccc"));
    expect(result.current.codeTitle).toContain("Atlas docs: aaaaaaa → bbbbbbb");
    expect(result.current.atlasTitle).toBe("Atlas docs: aaaaaaa → bbbbbbb\nClick to reload");
  });
});
