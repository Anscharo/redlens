// @vitest-environment jsdom
// jsdom has no canvas backend; pretext's text measurement needs a 2d context
// with measureText. A flat per-char width (mirrors Breadcrumbs.test.tsx's
// stub) is enough to exercise the layout branches deterministically.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const origGetContext = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: (id: string) => unknown }).getContext = ((
    id: string,
  ) => {
    if (id !== "2d") return null;
    return {
      font: "",
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
  }) as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
});

describe("truncateTitle", () => {
  it("returns '' when maxWidth is zero or negative", async () => {
    const { truncateTitle } = await import("./treeUtils");
    expect(truncateTitle("Some Title", 0)).toBe("");
    expect(truncateTitle("Some Title", -10)).toBe("");
  });

  it("returns the title unchanged when it fits on one line", async () => {
    const { truncateTitle } = await import("./treeUtils");
    expect(truncateTitle("Short", 2000)).toBe("Short");
  });

  it("truncates a long title to one line with a trailing ellipsis", async () => {
    const { truncateTitle } = await import("./treeUtils");
    const long =
      "A very long governance document title that will not fit on a single narrow line no matter what";
    const result = truncateTitle(long, 80);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThan(long.length);
  });

  it("is stable across repeated calls for the same text (exercises the measurement cache)", async () => {
    const { truncateTitle } = await import("./treeUtils");
    const long = "Another sufficiently long title to force a wrap at a narrow width";
    expect(truncateTitle(long, 60)).toBe(truncateTitle(long, 60));
  });
});
