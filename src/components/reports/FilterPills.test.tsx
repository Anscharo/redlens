// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FilterPills, PrimePills } from "./FilterPills";
import type { Pill } from "@/lib/reportChains";

afterEach(cleanup);

describe("FilterPills", () => {
  const items: Pill[] = [
    { id: "1", name: "Sky Base" },
    { id: "2", name: "Endgame Edge" },
  ];

  it("returns null when there are no items", () => {
    const { container } = render(
      <FilterPills label="GovOps" items={[]} kind="govops" filter={null} onToggle={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the label and one pill per item", () => {
    render(<FilterPills label="GovOps" items={items} kind="govops" filter={null} onToggle={() => {}} />);
    expect(screen.getByText("GovOps:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sky Base" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Endgame Edge" })).toBeInTheDocument();
  });

  it("marks the pill matching the active filter's kind + slug", () => {
    render(
      <FilterPills
        label="GovOps"
        items={items}
        kind="govops"
        filter={{ kind: "govops", slug: "sky-base" }}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Sky Base" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "Endgame Edge" })).not.toHaveAttribute("data-active");
  });

  it("does not mark any pill when the active filter is a different kind", () => {
    render(
      <FilterPills
        label="GovOps"
        items={items}
        kind="govops"
        filter={{ kind: "facilitator", slug: "sky-base" }}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Sky Base" })).not.toHaveAttribute("data-active");
  });

  it("calls onToggle with the kind + slugified name on click", () => {
    const onToggle = vi.fn();
    render(<FilterPills label="GovOps" items={items} kind="govops" filter={null} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Sky Base" }));
    expect(onToggle).toHaveBeenCalledWith({ kind: "govops", slug: "sky-base" });
  });
});

describe("PrimePills", () => {
  it("returns null when there are no agents", () => {
    const { container } = render(<PrimePills agents={[]} filter={null} onToggle={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the Prime label and one pill per agent", () => {
    render(<PrimePills agents={["Amatsu", "Keel"]} filter={null} onToggle={() => {}} />);
    expect(screen.getByText("Prime:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Amatsu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keel" })).toBeInTheDocument();
  });

  it("marks the pill matching an active agent filter", () => {
    render(
      <PrimePills agents={["Amatsu", "Keel"]} filter={{ kind: "agent", slug: "keel" }} onToggle={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Keel" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "Amatsu" })).not.toHaveAttribute("data-active");
  });

  it("calls onToggle with kind 'agent' and the slugified name", () => {
    const onToggle = vi.fn();
    render(<PrimePills agents={["Amatsu"]} filter={null} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Amatsu" }));
    expect(onToggle).toHaveBeenCalledWith({ kind: "agent", slug: "amatsu" });
  });
});
