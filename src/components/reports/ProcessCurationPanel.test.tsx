// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProcessCurationPanel } from "./ProcessCurationPanel";
import type { LocalIgnore } from "@/lib/curationStore";

afterEach(() => cleanup());

describe("ProcessCurationPanel", () => {
  it("shows the marked state with its reason and an Unmark button when already marked", () => {
    const existing: LocalIgnore = {
      uuid: "uuid-1",
      reason: "schema template",
      marked_at: "2026-07-01T00:00:00.000Z",
    };
    const onUnmark = vi.fn();
    render(
      <ProcessCurationPanel uuid="uuid-1" existing={existing} onMark={() => {}} onUnmark={onUnmark} />,
    );
    expect(screen.getByText("Marked as NonProcess")).toBeInTheDocument();
    expect(screen.getByText("schema template")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Unmark"));
    expect(onUnmark).toHaveBeenCalledWith("uuid-1");
  });

  it("shows the Mark as NonProcess entry point when not yet marked", () => {
    render(
      <ProcessCurationPanel uuid="uuid-1" existing={undefined} onMark={() => {}} onUnmark={() => {}} />,
    );
    expect(screen.getByText("Mark as NonProcess")).toBeInTheDocument();
    expect(screen.queryByText("Confirm")).not.toBeInTheDocument();
  });

  it("expands into the reason editor and confirms with the default reason", () => {
    const onMark = vi.fn();
    render(
      <ProcessCurationPanel uuid="uuid-1" existing={undefined} onMark={onMark} onUnmark={() => {}} />,
    );
    fireEvent.click(screen.getByText("Mark as NonProcess"));
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Confirm"));
    expect(onMark).toHaveBeenCalledWith("uuid-1", "schema template");
  });

  it("confirms with a different selected reason", () => {
    const onMark = vi.fn();
    render(
      <ProcessCurationPanel uuid="uuid-1" existing={undefined} onMark={onMark} onUnmark={() => {}} />,
    );
    fireEvent.click(screen.getByText("Mark as NonProcess"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "role definition" } });
    fireEvent.click(screen.getByText("Confirm"));
    expect(onMark).toHaveBeenCalledWith("uuid-1", "role definition");
  });

  it("requires custom text for the 'other' reason and disables Confirm until provided", () => {
    const onMark = vi.fn();
    render(
      <ProcessCurationPanel uuid="uuid-1" existing={undefined} onMark={onMark} onUnmark={() => {}} />,
    );
    fireEvent.click(screen.getByText("Mark as NonProcess"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "other" } });

    const confirmBtn = screen.getByText("Confirm");
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(confirmBtn);
    expect(onMark).not.toHaveBeenCalled();

    const input = screen.getByPlaceholderText("describe…");
    fireEvent.change(input, { target: { value: "vendor integration doc" } });
    expect(confirmBtn).toBeEnabled();

    fireEvent.click(confirmBtn);
    expect(onMark).toHaveBeenCalledWith("uuid-1", "vendor integration doc");
  });

  it("cancels the editor back to the entry point without calling onMark", () => {
    const onMark = vi.fn();
    render(
      <ProcessCurationPanel uuid="uuid-1" existing={undefined} onMark={onMark} onUnmark={() => {}} />,
    );
    fireEvent.click(screen.getByText("Mark as NonProcess"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "other" } });
    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.queryByText("Confirm")).not.toBeInTheDocument();
    expect(screen.getByText("Mark as NonProcess")).toBeInTheDocument();
    expect(onMark).not.toHaveBeenCalled();
  });
});
