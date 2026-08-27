// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReasoningBlock } from "./ReasoningBlock";

afterEach(cleanup);

describe("ReasoningBlock", () => {
  it("renders nothing for empty text", () => {
    const { container } = render(<ReasoningBlock text="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the reasoning text immediately, expanded by default", () => {
    render(<ReasoningBlock text="Checking the relevant scope first." />);
    expect(screen.getByText("Checking the relevant scope first.")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses and re-expands on click, remaining keyboard-operable via the button", () => {
    render(<ReasoningBlock text="A longer thinking trace." />);
    const head = screen.getByRole("button");
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("A longer thinking trace.")).toBeNull();
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A longer thinking trace.")).toBeInTheDocument();
  });
});
