// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PanelError, InlineError } from "./ErrorFallbacks";
import { pageReloader } from "@/lib/staleChunk";

beforeEach(() => {
  vi.spyOn(pageReloader, "reload").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function staleError() {
  return new TypeError("Failed to fetch dynamically imported module: https://x/assets/Foo-abc.js");
}

describe("PanelError", () => {
  it("shows the generic failure message and a retry button with no error", () => {
    const reset = vi.fn();
    render(<PanelError reset={reset} />);
    expect(screen.getByText("failed to load")).toBeInTheDocument();
    fireEvent.click(screen.getByText("retry"));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("omits the retry button when no reset callback is given", () => {
    render(<PanelError />);
    expect(screen.getByText("failed to load")).toBeInTheDocument();
    expect(screen.queryByText("retry")).toBeNull();
  });

  it("shows the stale-chunk message and a refresh button for a stale-chunk error", () => {
    render(<PanelError error={staleError()} reset={vi.fn()} />);
    expect(screen.getByText("a new version of the app is available")).toBeInTheDocument();
    expect(screen.queryByText("retry")).toBeNull();
    fireEvent.click(screen.getByText("refresh to update"));
    expect(pageReloader.reload).toHaveBeenCalledTimes(1);
  });

  it("shows the generic failure message for a non-stale error", () => {
    render(<PanelError error={new Error("boom")} reset={vi.fn()} />);
    expect(screen.getByText("failed to load")).toBeInTheDocument();
    expect(screen.getByText("retry")).toBeInTheDocument();
  });
});

describe("InlineError", () => {
  it("renders the generic failure text with no error", () => {
    render(<InlineError />);
    expect(screen.getByRole("alert")).toHaveTextContent("failed to render");
  });

  it("renders the generic failure text for a non-stale error", () => {
    render(<InlineError error={new Error("boom")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("failed to render");
  });

  it("renders the stale-chunk refresh prompt for a stale-chunk error", () => {
    render(<InlineError error={staleError()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("a new version of the app is available");
    fireEvent.click(screen.getByText("refresh"));
    expect(pageReloader.reload).toHaveBeenCalledTimes(1);
  });
});
