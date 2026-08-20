// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const track = vi.fn();
vi.mock("../../lib/analytics", () => ({ track: (...args: unknown[]) => track(...args) }));

const downloadCSV = vi.fn();
vi.mock("../../lib/csvDownload", () => ({ downloadCSV: (...args: unknown[]) => downloadCSV(...args) }));

import { DownloadCsvButton } from "./DownloadCsvButton";

afterEach(() => {
  cleanup();
  delete (window as unknown as { __ATLAS_SHA__?: string }).__ATLAS_SHA__;
});

beforeEach(() => {
  track.mockClear();
  downloadCSV.mockClear();
});

const baseProps = {
  report: "test-report",
  filename: "test-report.csv",
  build: () => "filtered,csv",
  buildFull: () => "full,csv",
};

describe("DownloadCsvButton", () => {
  it("only shows the full download button when no filter is active", () => {
    render(<DownloadCsvButton {...baseProps} rowCount={5} fullRowCount={5} query="" />);
    expect(screen.getByRole("button", { name: "Download full report" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download filtered report" })).not.toBeInTheDocument();
  });

  it("shows both buttons when a query is active", () => {
    render(<DownloadCsvButton {...baseProps} rowCount={2} fullRowCount={5} query="vote" />);
    expect(screen.getByRole("button", { name: "Download full report" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download filtered report" })).toBeInTheDocument();
  });

  it("shows both buttons when a pill filter is active even with no query", () => {
    render(
      <DownloadCsvButton {...baseProps} rowCount={2} fullRowCount={5} query="" filters={["Sky Base"]} />,
    );
    expect(screen.getByRole("button", { name: "Download filtered report" })).toBeInTheDocument();
  });

  it("disables the full button at zero full rows", () => {
    render(<DownloadCsvButton {...baseProps} rowCount={0} fullRowCount={0} query="" />);
    expect(screen.getByRole("button", { name: "Download full report" })).toBeDisabled();
  });

  it("disables the filtered button at zero filtered rows", () => {
    render(<DownloadCsvButton {...baseProps} rowCount={0} fullRowCount={5} query="vote" />);
    expect(screen.getByRole("button", { name: "Download filtered report" })).toBeDisabled();
  });

  it("clicking the full button tracks the export and downloads the full CSV under the plain filename", () => {
    render(<DownloadCsvButton {...baseProps} rowCount={2} fullRowCount={5} query="vote" />);
    fireEvent.click(screen.getByRole("button", { name: "Download full report" }));
    expect(track).toHaveBeenCalledWith("report_export", {
      report: "test-report",
      format: "csv",
      row_count: 5,
      scope: "full",
    });
    expect(downloadCSV).toHaveBeenCalledWith("test-report.csv", "full,csv");
  });

  it("clicking the filtered button tracks the export and downloads under a filter-marked filename", () => {
    render(<DownloadCsvButton {...baseProps} rowCount={2} fullRowCount={5} query="vote" />);
    fireEvent.click(screen.getByRole("button", { name: "Download filtered report" }));
    expect(track).toHaveBeenCalledWith("report_export", {
      report: "test-report",
      format: "csv",
      row_count: 2,
      scope: "filtered",
    });
    expect(downloadCSV).toHaveBeenCalledWith("test-report.vote.csv", "filtered,csv");
  });

  it("inserts the atlas sha prefix into the downloaded filename when a live sha is injected", () => {
    (window as unknown as { __ATLAS_SHA__?: string }).__ATLAS_SHA__ = "a".repeat(40);
    render(<DownloadCsvButton {...baseProps} rowCount={2} fullRowCount={5} query="" />);
    fireEvent.click(screen.getByRole("button", { name: "Download full report" }));
    expect(downloadCSV).toHaveBeenCalledWith("test-report.aaaaaaaa.csv", "full,csv");
  });
});
