// @vitest-environment jsdom
// BuildErrorDetail renders the raw build-error message, plus — only when the
// message carries exactly two distinct backticked values — an expected/found
// character diff pair.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BuildErrorDetail } from "./BuildErrorDetail";

afterEach(cleanup);

describe("BuildErrorDetail", () => {
  it("renders the raw message text", () => {
    render(<BuildErrorDetail message="atlas parse failed: unexpected token" />);
    expect(screen.getByText("atlas parse failed: unexpected token")).toBeTruthy();
  });

  it("does not render a diff when there are no backticked values", () => {
    render(<BuildErrorDetail message="something went wrong" />);
    expect(screen.queryByText("expected")).toBeNull();
    expect(screen.queryByText("found")).toBeNull();
  });

  it("does not render a diff when there is only one backticked value", () => {
    render(<BuildErrorDetail message="bad doc_no `A.2.2.8.1`" />);
    expect(screen.queryByText("expected")).toBeNull();
  });

  it("does not render a diff when the two backticked values are identical", () => {
    render(<BuildErrorDetail message="mismatch `A.2.2.8` vs `A.2.2.8`" />);
    expect(screen.queryByText("expected")).toBeNull();
  });

  it("renders an expected/found char diff for exactly two distinct backticked values", () => {
    render(<BuildErrorDetail message="doc_no mismatch: expected `A.2.2.8` found `A.2.2.8.`" />);
    expect(screen.getByText("expected")).toBeTruthy();
    expect(screen.getByText("found")).toBeTruthy();
  });

  it("does not render a diff when there are three or more backticked values", () => {
    render(<BuildErrorDetail message="`a` `b` `c`" />);
    expect(screen.queryByText("expected")).toBeNull();
    expect(screen.queryByText("found")).toBeNull();
  });

  it("marks the trailing-dot difference as an added character in the found line", () => {
    const { container } = render(<BuildErrorDetail message="expected `A.2.2.8` found `A.2.2.8.`" />);
    // The "found" line highlights the extra trailing "." that isn't in "expected".
    const marks = container.querySelectorAll('span[style*="font-weight"]');
    expect(marks.length).toBeGreaterThan(0);
    const markedTexts = Array.from(marks).map((m) => m.textContent);
    expect(markedTexts).toContain(".");
  });
});
