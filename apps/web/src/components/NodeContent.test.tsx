// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
  vi.doUnmock("./NodeContentInner");
  vi.resetModules();
});

describe("NodeContent", () => {
  it("renders its content through the lazy-loaded inner renderer", async () => {
    const { NodeContent } = await import("./NodeContent");
    render(<NodeContent content="Hello world." />);
    expect(await screen.findByText("Hello world.")).toBeInTheDocument();
  });

  it("passes onNavigate through to the inner renderer for UUID links", async () => {
    const { NodeContent } = await import("./NodeContent");
    const onNavigate = vi.fn();
    const UUID = "1ce24b08-84ff-4524-9710-49bba429c6ef";
    render(<NodeContent content={`[Go](${UUID})`} onNavigate={onNavigate} />);
    const link = await screen.findByRole("link", { name: "Go" });
    expect(link).toHaveAttribute("href", `/atlas?id=${UUID}`);
  });

  it("shows the error fallback when the inner renderer throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("./NodeContentInner", () => ({
      default: () => {
        throw new Error("boom");
      },
    }));
    const { NodeContent } = await import("./NodeContent");
    render(<NodeContent content="anything" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("failed to render");
  });
});

describe("prefetchNodeContent", () => {
  it("schedules a warm-up via requestIdleCallback when available", async () => {
    const { prefetchNodeContent } = await import("./NodeContent");
    const ric = vi.fn((cb: IdleRequestCallback) => {
      cb({} as IdleDeadline);
      return 1;
    });
    (window as unknown as { requestIdleCallback: typeof ric }).requestIdleCallback = ric;
    prefetchNodeContent();
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 });
    delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
  });

  it("falls back to setTimeout when requestIdleCallback is unavailable", async () => {
    const { prefetchNodeContent } = await import("./NodeContent");
    delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    prefetchNodeContent();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1500);
    setTimeoutSpy.mockRestore();
  });
});
