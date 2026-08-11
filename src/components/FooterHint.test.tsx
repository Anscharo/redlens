// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FooterHint } from "./FooterHint";
import { hintStore } from "../lib/hintStore";

afterEach(() => {
  cleanup();
  act(() => {
    hintStore.setHover(null);
    hintStore.setFocus(null);
  });
});

describe("FooterHint", () => {
  it("renders nothing when there is no hint", () => {
    const { container } = render(<FooterHint />);
    expect(container).toBeEmptyDOMElement();
  });

  // textContent, not getByText: arrow runs are wrapped in their own span (see
  // the enlargement tests below), so the hint is several nodes, not one.
  it("renders the focus hint", () => {
    act(() => hintStore.setFocus("↑↓ to navigate"));
    const { container } = render(<FooterHint />);
    expect(container.textContent).toBe("↑↓ to navigate");
  });

  it("shows the hovered hint over the focused one", () => {
    act(() => {
      hintStore.setFocus("↑↓ to navigate");
      hintStore.setHover("Shift-click → open in Splitview");
    });
    const { container } = render(<FooterHint />);
    expect(container.textContent).toBe("Shift-click → open in Splitview");
  });

  it("updates live as the hint changes", () => {
    render(<FooterHint />);
    act(() => hintStore.setHover("first"));
    expect(screen.getByText("first")).toBeInTheDocument();
    act(() => hintStore.setHover("second"));
    expect(screen.getByText("second")).toBeInTheDocument();
    act(() => hintStore.setHover(null));
    expect(screen.queryByText("second")).not.toBeInTheDocument();
  });

  it("draws a run of arrow glyphs as one keycap each", () => {
    act(() => hintStore.setFocus("↑↓←→ Enter (+ Shift) to navigate"));
    const { container } = render(<FooterHint />);
    expect([...container.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual([
      "↑", "↓", "←", "→",
    ]);
    // The sentence around them is untouched, spacing included.
    expect(container.textContent).toBe("↑↓←→ Enter (+ Shift) to navigate");
  });

  it("leaves a lone arrow as plain text — it separates, it isn't a key", () => {
    act(() => hintStore.setHover("Shift-click → open in Splitview"));
    const { container } = render(<FooterHint />);
    expect(container.querySelector("kbd")).toBeNull();
    expect(container.textContent).toBe("Shift-click → open in Splitview");
  });

  it("is hidden from assistive tech — every gesture it names is reachable another way", () => {
    act(() => hintStore.setHover("Shift-click → open in Splitview"));
    const { container } = render(<FooterHint />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
