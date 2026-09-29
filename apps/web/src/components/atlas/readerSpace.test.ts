import { describe, expect, it } from "vitest";
import { rightPanelLayout } from "./readerSpace";

describe("rightPanelLayout", () => {
  it("keeps the preferred width until the reader row is measured", () => {
    expect(rightPanelLayout({ preferred: 520, rowWidth: 0, hideForBreakpoint: false })).toEqual({
      hidden: false,
      width: 520,
    });
  });

  it("hides below the breakpoint and leaves the stored preference alone", () => {
    expect(rightPanelLayout({ preferred: 600, rowWidth: 900, hideForBreakpoint: true })).toEqual({
      hidden: true,
      width: 600,
    });
  });

  it("shrinks the panel so the reader keeps 400px", () => {
    expect(rightPanelLayout({ preferred: 520, rowWidth: 760, hideForBreakpoint: false })).toEqual({
      hidden: false,
      width: 360,
    });
  });

  it("can collapse below the old 260px floor", () => {
    expect(rightPanelLayout({ preferred: 520, rowWidth: 640, hideForBreakpoint: false })).toEqual({
      hidden: false,
      width: 240,
    });
  });

  it("stays open at the 200px floor when that still leaves the reader 400px", () => {
    expect(rightPanelLayout({ preferred: 520, rowWidth: 600, hideForBreakpoint: false })).toEqual({
      hidden: false,
      width: 200,
    });
  });

  it("hides when fewer than 200px would remain beside a 400px reader", () => {
    expect(rightPanelLayout({ preferred: 520, rowWidth: 500, hideForBreakpoint: false })).toEqual({
      hidden: true,
      width: 520,
    });
  });

  it("does not grow past the preferred width on a wide row", () => {
    expect(rightPanelLayout({ preferred: 520, rowWidth: 1200, hideForBreakpoint: false })).toEqual({
      hidden: false,
      width: 520,
    });
  });
});
