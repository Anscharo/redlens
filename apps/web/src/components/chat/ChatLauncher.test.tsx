// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChatLauncher } from "./ChatLauncher";
import type { PageContextView } from "./pageContext";

afterEach(cleanup);

const context: PageContextView = {
  short: "Ask the Sky Atlas",
  placeholder: "Ask…",
  label: "Sky Atlas",
  chip: "atlas",
};

describe("ChatLauncher", () => {
  it("renders the context-aware short label and the ⌘K hint", () => {
    render(<ChatLauncher onOpen={vi.fn()} context={context} />);
    expect(screen.getByText("Ask the Sky Atlas")).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("calls onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(<ChatLauncher onOpen={onOpen} context={context} />);
    fireEvent.click(screen.getByLabelText("Open the Atlas agent"));
    expect(onOpen).toHaveBeenCalled();
  });
});
