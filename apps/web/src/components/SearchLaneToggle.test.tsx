// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SearchLaneToggle } from "./SearchLaneToggle";

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof SearchLaneToggle>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <SearchLaneToggle lane="lexical" onSelect={onSelect} semanticAvailable {...over} />,
  );
  return { onSelect };
}

describe("SearchLaneToggle", () => {
  it("is a radiogroup with one option per index, in reader wording", () => {
    setup();
    expect(screen.getByRole("radiogroup", { name: "Search index" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    for (const label of ["wording", "entities", "meaning"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("marks exactly the active lane, for assistive tech and for CSS", () => {
    setup({ lane: "semantic" });
    const active = screen.getByText("meaning");
    expect(active).toHaveAttribute("aria-checked", "true");
    expect(active).toHaveAttribute("data-state", "active");
    expect(screen.getByText("wording")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("wording")).toHaveAttribute("data-state", "inactive");
  });

  it("reports the picked lane", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByText("entities"));
    expect(onSelect).toHaveBeenCalledWith("graph");
  });

  it("disables only the meaning lane when the deployment cannot answer it", () => {
    const { onSelect } = setup({ semanticAvailable: false });
    const meaning = screen.getByText("meaning");
    expect(meaning).toBeDisabled();
    fireEvent.click(meaning);
    expect(onSelect).not.toHaveBeenCalled();
    // The other two lanes are local and keep working.
    expect(screen.getByText("wording")).not.toBeDisabled();
    expect(screen.getByText("entities")).not.toBeDisabled();
  });
});
