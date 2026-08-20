// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...args: unknown[]) => track(...args) }));

const downloadCSV = vi.fn();
vi.mock("@/lib/csvDownload", () => ({ downloadCSV: (...args: unknown[]) => downloadCSV(...args) }));

import { SingleDownloadButton } from "./SingleDownloadButton";

afterEach(() => {
  cleanup();
  delete (window as unknown as { __ATLAS_SHA__?: string }).__ATLAS_SHA__;
});

beforeEach(() => {
  track.mockClear();
  downloadCSV.mockClear();
});

const baseProps = {
  report: "test-report-summary",
  filename: "test-report-summary.csv",
  build: () => "a,b,c",
  label: "Download by section (CSV)",
};

describe("SingleDownloadButton", () => {
  it("renders a single button with the given label", () => {
    render(<SingleDownloadButton {...baseProps} rowCount={5} />);
    expect(screen.getByRole("button", { name: "Download by section (CSV)" })).toBeInTheDocument();
  });

  it("disables the button at zero rows", () => {
    render(<SingleDownloadButton {...baseProps} rowCount={0} />);
    expect(screen.getByRole("button", { name: "Download by section (CSV)" })).toBeDisabled();
  });

  it("clicking tracks the export and downloads the CSV under the plain filename", () => {
    render(<SingleDownloadButton {...baseProps} rowCount={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Download by section (CSV)" }));
    expect(track).toHaveBeenCalledWith("report_export", {
      report: "test-report-summary",
      format: "csv",
      row_count: 5,
      scope: "full",
    });
    expect(downloadCSV).toHaveBeenCalledWith("test-report-summary.csv", "a,b,c");
  });

  it("inserts the atlas sha prefix into the downloaded filename when a live sha is injected", () => {
    (window as unknown as { __ATLAS_SHA__?: string }).__ATLAS_SHA__ = "a".repeat(40);
    render(<SingleDownloadButton {...baseProps} rowCount={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Download by section (CSV)" }));
    expect(downloadCSV).toHaveBeenCalledWith("test-report-summary.aaaaaaaa.csv", "a,b,c");
  });
});
