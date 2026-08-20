// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProcessCurationBar } from "./ProcessCurationBar";
import type { LocalIgnore } from "@/lib/curationStore";

URL.createObjectURL = vi.fn(() => "blob:x");
URL.revokeObjectURL = vi.fn();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mark = (uuid: string, reason: string): LocalIgnore => ({
  uuid,
  reason,
  marked_at: "2026-07-01T00:00:00.000Z",
});

describe("ProcessCurationBar", () => {
  it("renders nothing when there are no marks", () => {
    const { container } = render(
      <ProcessCurationBar
        marks={[]}
        onClear={() => {}}
        showIgnored={false}
        onToggleShowIgnored={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the count of locally marked processes", () => {
    render(
      <ProcessCurationBar
        marks={[mark("uuid-1", "schema template"), mark("uuid-2", "other")]}
        onClear={() => {}}
        showIgnored={false}
        onToggleShowIgnored={() => {}}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/marked locally as NonProcess/)).toBeInTheDocument();
  });

  it("downloads a decisions JSON blob when Download JSON is clicked", () => {
    render(
      <ProcessCurationBar
        marks={[mark("uuid-1", "schema template")]}
        onClear={() => {}}
        showIgnored={false}
        onToggleShowIgnored={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Download JSON"));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  it("copies the decisions JSON to the clipboard and flashes Copied!", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <ProcessCurationBar
        marks={[mark("uuid-1", "schema template")]}
        onClear={() => {}}
        showIgnored={false}
        onToggleShowIgnored={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Copy JSON"));

    await waitFor(() => expect(screen.getByText("Copied!")).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0][0] as string;
    const decisions = JSON.parse(written);
    expect(decisions).toEqual([{ uuid: "uuid-1", verdict: "ignore", reason: "schema template" }]);
  });

  it("silently ignores a clipboard write failure", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <ProcessCurationBar
        marks={[mark("uuid-1", "schema template")]}
        onClear={() => {}}
        showIgnored={false}
        onToggleShowIgnored={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Copy JSON"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    expect(screen.getByText("Copy JSON")).toBeInTheDocument();
  });

  it("toggles the show-ignored label based on the showIgnored prop and calls the handler", () => {
    const onToggleShowIgnored = vi.fn();
    const { rerender } = render(
      <ProcessCurationBar
        marks={[mark("uuid-1", "schema template")]}
        onClear={() => {}}
        showIgnored={false}
        onToggleShowIgnored={onToggleShowIgnored}
      />,
    );
    fireEvent.click(screen.getByText("Show ignored"));
    expect(onToggleShowIgnored).toHaveBeenCalledTimes(1);

    rerender(
      <ProcessCurationBar
        marks={[mark("uuid-1", "schema template")]}
        onClear={() => {}}
        showIgnored={true}
        onToggleShowIgnored={onToggleShowIgnored}
      />,
    );
    expect(screen.getByText("Hide ignored")).toBeInTheDocument();
  });

  it("calls onClear when Clear all is clicked", () => {
    const onClear = vi.fn();
    render(
      <ProcessCurationBar
        marks={[mark("uuid-1", "schema template")]}
        onClear={onClear}
        showIgnored={false}
        onToggleShowIgnored={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Clear all"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
