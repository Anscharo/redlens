// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FooterHint } from "./FooterHint";
import { hintStore } from "../lib/hintStore";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

vi.mock("../hooks/useOnlineStatus", () => ({ useOnlineStatus: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  (useOnlineStatus as unknown as Mock).mockReturnValue(true);
});

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

  it("renders the focus hint", () => {
    act(() => hintStore.setFocus("↑↓ to navigate"));
    render(<FooterHint />);
    expect(screen.getByText("↑↓ to navigate")).toBeInTheDocument();
  });

  it("shows the hovered hint over the focused one", () => {
    act(() => {
      hintStore.setFocus("↑↓ to navigate");
      hintStore.setHover("Shift-click → open in Splitview");
    });
    render(<FooterHint />);
    expect(screen.getByText("Shift-click → open in Splitview")).toBeInTheDocument();
    expect(screen.queryByText("↑↓ to navigate")).not.toBeInTheDocument();
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

  it("yields the slot to the offline pill", () => {
    // Offline is a live fault the user cannot dismiss, and tree focus is sticky
    // enough to bury it for a whole session.
    (useOnlineStatus as unknown as Mock).mockReturnValue(false);
    act(() => hintStore.setFocus("↑↓ to navigate"));
    const { container } = render(<FooterHint />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is hidden from assistive tech — every gesture it names is reachable another way", () => {
    act(() => hintStore.setHover("Shift-click → open in Splitview"));
    const { container } = render(<FooterHint />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
