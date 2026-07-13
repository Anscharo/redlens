// @vitest-environment jsdom
// ErrorBoundary is what keeps a single throwing node (AddressCard, NodeContent,
// a panel) from blanking the whole reader. We assert it catches render errors,
// passes (error, reset) to a function fallback, and clears on resetKey change.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { ErrorBoundary, InlineError, PanelError } from "./ErrorBoundary";
import { pageReloader } from "../lib/staleChunk";

// React logs caught render errors; silence it so the suite output stays clean.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(pageReloader, "reload").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Bomb({ boom }: { boom: boolean }) {
  if (boom) throw new Error("kaboom");
  return <div>safe content</div>;
}

// A stale-chunk throw: what React sees when a lazy component's hashed chunk
// was replaced by a newer deploy (Chrome phrasing).
function StaleBomb(): never {
  throw new TypeError("Failed to fetch dynamically imported module: https://x/assets/NodeContentInner-abc.js");
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary fallback={<InlineError />}>
        <Bomb boom={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("safe content")).toBeInTheDocument();
  });

  it("renders the static fallback when a child throws", () => {
    render(
      <ErrorBoundary fallback={<InlineError />}>
        <Bomb boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("failed to render");
    expect(screen.queryByText("safe content")).toBeNull();
  });

  it("passes the caught error to a function fallback", () => {
    render(
      <ErrorBoundary fallback={(error) => <p>caught: {error.message}</p>}>
        <Bomb boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("caught: kaboom")).toBeInTheDocument();
  });

  it("invokes onError with the thrown error", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary fallback={<InlineError />} onError={onError}>
        <Bomb boom />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("clears the error and re-renders children when resetKey changes", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="a" fallback={<InlineError />}>
        <Bomb boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // New resetKey + a child that no longer throws → boundary recovers.
    rerender(
      <ErrorBoundary resetKey="b" fallback={<InlineError />}>
        <Bomb boom={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("safe content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the refresh prompt on a stale-chunk error without auto-reloading", () => {
    render(
      <ErrorBoundary fallback={(error) => <InlineError error={error} />}>
        <StaleBomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("a new version of the app is available");
    // Deliberately NO auto-reload — the user decides via the button.
    expect(pageReloader.reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("refresh"));
    expect(pageReloader.reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the plain failure text for non-stale errors", () => {
    render(
      <ErrorBoundary fallback={(error) => <InlineError error={error} />}>
        <Bomb boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("failed to render");
    expect(pageReloader.reload).not.toHaveBeenCalled();
  });

  it("PanelError swaps retry for refresh-to-update on a stale-chunk error", () => {
    render(
      <ErrorBoundary fallback={(error, reset) => <PanelError error={error} reset={reset} />}>
        <StaleBomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("a new version of the app is available")).toBeInTheDocument();
    expect(screen.queryByText("retry")).toBeNull();
    fireEvent.click(screen.getByText("refresh to update"));
    expect(pageReloader.reload).toHaveBeenCalledTimes(1);
  });

  it("resets via the function fallback's reset callback once the cause is fixed", () => {
    // reset() alone re-renders the same children; recovery needs the underlying
    // cause gone too, so retry both fixes state and resets the boundary.
    function Wrapper() {
      const [boom, setBoom] = useState(true);
      return (
        <ErrorBoundary
          fallback={(_e, reset) => (
            <button onClick={() => { setBoom(false); reset(); }}>retry</button>
          )}
        >
          <Bomb boom={boom} />
        </ErrorBoundary>
      );
    }
    render(<Wrapper />);
    fireEvent.click(screen.getByText("retry"));
    expect(screen.getByText("safe content")).toBeInTheDocument();
  });
});
