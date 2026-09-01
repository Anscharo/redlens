// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ChatHeader, DELIVERY_LOCKED_HINT, DELIVERY_MODE_HINT } from "./ChatHeader";

function renderHeader(over: Partial<React.ComponentProps<typeof ChatHeader>> = {}) {
  const onNewChat = vi.fn();
  const onClose = vi.fn();
  const onTogglePlacement = vi.fn();
  const props = {
    title: null,
    onNewChat,
    onClose,
    placement: "float" as const,
    onTogglePlacement,
    stages: false,
    onToggleDelivery: vi.fn(),
    streaming: false,
    ...over,
  };
  const utils = render(<ChatHeader {...props} />);
  return { ...utils, onNewChat, onClose, onTogglePlacement };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChatHeader", () => {
  it("falls back to 'Atlas' when there is no conversation title", () => {
    renderHeader({ title: null });
    expect(screen.getByText("Atlas")).toBeInTheDocument();
  });

  it("shows the conversation title when set", () => {
    renderHeader({ title: "Budget rewards question" });
    expect(screen.getByText("Budget rewards question")).toBeInTheDocument();
  });

  it("calls onNewChat when New chat is clicked", () => {
    const { onNewChat } = renderHeader();
    fireEvent.click(screen.getByLabelText("New chat"));
    expect(onNewChat).toHaveBeenCalled();
  });

  it("calls onClose when Close is clicked", () => {
    const { onClose } = renderHeader();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a dock icon while floating; clicking it calls onTogglePlacement", () => {
    const { onTogglePlacement } = renderHeader({ placement: "float" });
    expect(screen.getByTitle("Dock to the side")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Dock to the side"));
    expect(onTogglePlacement).toHaveBeenCalled();
  });

  it("shows a float-out control while anchored", () => {
    renderHeader({ placement: "anchored" });
    expect(screen.getByTitle("Pop out to a floating window")).toBeInTheDocument();
  });

  it("labels the delivery pill streaming when not in stages mode", () => {
    renderHeader({ stages: false });
    const toggle = screen.getByLabelText(DELIVERY_MODE_HINT);
    expect(toggle).toHaveTextContent("streaming");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("title", DELIVERY_MODE_HINT);
    expect(toggle).toBeEnabled();
  });

  it("labels the delivery pill stages when pressed, and click flips", () => {
    const onToggleDelivery = vi.fn();
    renderHeader({ stages: true, onToggleDelivery });
    const toggle = screen.getByLabelText(DELIVERY_MODE_HINT);
    expect(toggle).toHaveTextContent("stages");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(onToggleDelivery).toHaveBeenCalled();
  });

  it("disables the delivery pill while streaming and ignores clicks", async () => {
    const onToggleDelivery = vi.fn();
    renderHeader({ streaming: true, onToggleDelivery });
    const toggle = screen.getByLabelText(DELIVERY_LOCKED_HINT);
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("title", DELIVERY_LOCKED_HINT);
    await userEvent.click(toggle);
    expect(onToggleDelivery).not.toHaveBeenCalled();
  });
});
