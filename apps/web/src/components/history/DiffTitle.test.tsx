// @vitest-environment jsdom
// DiffTitle is the preview entry's title line: the PR's title, else the branch,
// carrying line 1's height when nothing sits above it.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { DiffTitle } from "./DiffTitle";
import { LINE1_H } from "./Timeline";

afterEach(cleanup);

describe("DiffTitle", () => {
  it("shows a PR's title under line 1", () => {
    render(<DiffTitle meta={{ prNumber: 42, prTitle: "Add a thing", ref: "feat/x" }} belowLine1 />);
    expect(screen.getByText("Add a thing")).toHaveClass("mt-1");
    expect(screen.queryByText(/Branch:/)).toBeNull();
  });

  it("names the branch when there is no PR, as the first line when nothing is above it", () => {
    render(<DiffTitle meta={{ ref: "feat/x", repo: "someone/next-gen-atlas" }} belowLine1={false} />);
    expect(screen.getByText("Branch: someone/feat/x")).toHaveStyle({ lineHeight: `${LINE1_H}px` });
  });

  it("renders nothing when meta names neither", () => {
    const { container } = render(<DiffTitle meta={{ prNumber: 42 }} belowLine1 />);
    expect(container).toBeEmptyDOMElement();
  });
});
