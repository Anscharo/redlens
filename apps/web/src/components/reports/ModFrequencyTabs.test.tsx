// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ModFrequencyTabs } from "./ModFrequencyTabs";

afterEach(cleanup);

describe("ModFrequencyTabs", () => {
  it("renders all three tabs with the active one marked selected", () => {
    render(<ModFrequencyTabs active="sum-by" onChange={vi.fn()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["timeline", "sum by", "list"]);
    expect(screen.getByRole("tab", { name: "sum by" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "timeline" })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange with the clicked tab", () => {
    const onChange = vi.fn();
    render(<ModFrequencyTabs active="timeline" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "list" }));
    expect(onChange).toHaveBeenCalledWith("list");
  });
});
