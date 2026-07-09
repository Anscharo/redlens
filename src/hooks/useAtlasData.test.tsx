// @vitest-environment jsdom
// useLoaded rejection handling (deep review Exec #5): a rejected loader must not
// become a permanent "Loading…" + an unhandled rejection. By default the error
// re-throws during render so an ErrorBoundary catches it; `{ soft: true }` swallows
// it and returns null so an enrichment failure doesn't blank the page.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useLoaded } from "./useAtlasData";

class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    return this.state.err ? <div>caught:{this.state.err.message}</div> : this.props.children;
  }
}

function Probe({ loader, soft }: { loader: () => Promise<string>; soft?: boolean }) {
  const v = useLoaded(loader, soft ? { soft: true } : undefined);
  return <div data-testid="val">{v === null ? "null" : v}</div>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useLoaded", () => {
  it("returns the resolved value", async () => {
    render(
      <Boundary>
        <Probe loader={() => Promise.resolve("hello")} />
      </Boundary>,
    );
    expect(await screen.findByText("hello")).toBeTruthy();
  });

  it("re-throws a load failure to the ErrorBoundary by default", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // silence boundary noise
    render(
      <Boundary>
        <Probe loader={() => Promise.reject(new Error("load failed"))} />
      </Boundary>,
    );
    expect(await screen.findByText(/caught:load failed/)).toBeTruthy();
  });

  it("swallows a load failure in soft mode and stays null (no throw)", async () => {
    render(
      <Boundary>
        <Probe loader={() => Promise.reject(new Error("load failed"))} soft />
      </Boundary>,
    );
    // Let the effect + rejection settle across a couple of microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText(/caught:/)).toBeNull();
    expect(screen.getByTestId("val").textContent).toBe("null");
  });
});
