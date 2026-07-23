// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Loading } from "./Loading";

afterEach(() => {
  cleanup();
});

describe("Loading", () => {
  it("renders the default copy when no children are given", () => {
    render(<Loading />);
    expect(screen.getByText("searching the stars")).toBeInTheDocument();
    expect(screen.getByText("✦")).toBeInTheDocument();
  });

  it("renders custom children instead of the default copy", () => {
    render(<Loading>loading reports</Loading>);
    expect(screen.getByText("loading reports")).toBeInTheDocument();
    expect(screen.queryByText("searching the stars")).toBeNull();
  });
});
