// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CommonsNote } from "./CommonsNote";

afterEach(cleanup);

describe("CommonsNote", () => {
  it("renders nothing when commons is null (feature off / credits hiccup)", () => {
    const { container } = render(<CommonsNote commons={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders remaining/total and is not flagged low above the 10% floor", () => {
    render(<CommonsNote commons={{ used: 10, total: 100, remaining: 90 }} />);
    expect(screen.getByText("$90.00 left of $100.00")).toBeInTheDocument();
    expect(screen.getByText("$90.00 left of $100.00")).toHaveAttribute("data-low", "false");
  });

  it("flags low when remaining is at or under 10% of total", () => {
    render(<CommonsNote commons={{ used: 95, total: 100, remaining: 5 }} />);
    expect(screen.getByText("$5.00 left of $100.00")).toHaveAttribute("data-low", "true");
  });

  it("treats a drained pool (total <= 0) as low even with remaining 0", () => {
    render(<CommonsNote commons={{ used: 0, total: 0, remaining: 0 }} />);
    expect(screen.getByText("$0.00 left of $0.00")).toHaveAttribute("data-low", "true");
  });

  it("includes used/total in the title tooltip", () => {
    const { container } = render(<CommonsNote commons={{ used: 12.5, total: 50, remaining: 37.5 }} />);
    const root = container.querySelector(".rlc-commons");
    expect(root).toHaveAttribute("title", "Shared pool across all users — $12.50 used of $50.00");
  });
});
