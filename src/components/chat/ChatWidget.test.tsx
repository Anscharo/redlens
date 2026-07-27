// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { PageContextView } from "./pageContext";

const context: PageContextView = {
  short: "Ask the Sky Atlas",
  placeholder: "Ask…",
  label: "Sky Atlas",
  chip: "atlas",
};
vi.mock("./pageContext", () => ({ usePageContext: () => context }));

vi.mock("./ChatPanel", () => ({
  ChatPanel: ({
    onClose,
    onAtlas,
    placement,
    onTogglePlacement,
  }: {
    onClose: () => void;
    onAtlas: (uuid: string) => void;
    placement: string;
    onTogglePlacement: () => void;
  }) => (
    <div data-testid="chat-panel">
      <span data-testid="placement">{placement}</span>
      <button onClick={onClose}>close-panel</button>
      <button onClick={() => onAtlas("11111111-1111-1111-1111-111111111111")}>cite</button>
      <button onClick={onTogglePlacement}>toggle-placement</button>
    </div>
  ),
}));

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../lib/analytics", () => ({ track }));

import { ChatWidget } from "./ChatWidget";

function LocationProbe() {
  const [loc] = useLocation();
  return <p data-testid="loc">{loc}</p>;
}

function renderWidget(path = "/") {
  const { hook } = memoryLocation({ path, record: true });
  return render(
    <Router hook={hook}>
      <ChatWidget />
      <LocationProbe />
    </Router>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.body.className = "";
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.className = "";
  vi.clearAllMocks();
});

describe("ChatWidget open/close", () => {
  it("renders the collapsed launcher initially", () => {
    renderWidget();
    expect(screen.getByLabelText("Open the Atlas agent")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("opens the panel on launcher click and tracks chat_open once", () => {
    renderWidget();
    fireEvent.click(screen.getByLabelText("Open the Atlas agent"));
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith("chat_open", { product: "chat" });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("opens via ⌘K and does not double-track when already open", () => {
    renderWidget();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("opens via Ctrl+K too (non-mac)", () => {
    renderWidget();
    fireEvent.keyDown(window, { key: "K", ctrlKey: true });
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderWidget();
    fireEvent.click(screen.getByLabelText("Open the Atlas agent"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("closes via the panel's onClose", () => {
    renderWidget();
    fireEvent.click(screen.getByLabelText("Open the Atlas agent"));
    fireEvent.click(screen.getByText("close-panel"));
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });
});

describe("ChatWidget placement", () => {
  it("defaults to float placement when nothing is persisted", () => {
    renderWidget();
    fireEvent.click(screen.getByLabelText("Open the Atlas agent"));
    expect(screen.getByTestId("placement")).toHaveTextContent("float");
    expect(document.body.classList.contains("rlc-anchored")).toBe(false);
  });

  it("restores a persisted anchored placement and applies the body class while open", () => {
    localStorage.setItem("rlc-placement", "anchored");
    renderWidget();
    fireEvent.click(screen.getByLabelText("Open the Atlas agent"));
    expect(screen.getByTestId("placement")).toHaveTextContent("anchored");
    expect(document.body.classList.contains("rlc-anchored")).toBe(true);
  });

  it("toggling placement persists the new value and updates the body class", () => {
    renderWidget();
    fireEvent.click(screen.getByLabelText("Open the Atlas agent"));
    fireEvent.click(screen.getByText("toggle-placement"));
    expect(screen.getByTestId("placement")).toHaveTextContent("anchored");
    expect(localStorage.getItem("rlc-placement")).toBe("anchored");
    expect(document.body.classList.contains("rlc-anchored")).toBe(true);
    fireEvent.click(screen.getByText("toggle-placement"));
    expect(screen.getByTestId("placement")).toHaveTextContent("float");
    expect(document.body.classList.contains("rlc-anchored")).toBe(false);
  });

  it("does not apply the anchored body class when anchored but closed", () => {
    localStorage.setItem("rlc-placement", "anchored");
    renderWidget();
    expect(document.body.classList.contains("rlc-anchored")).toBe(false);
  });

  it("clears the anchored body class when the panel closes", () => {
    localStorage.setItem("rlc-placement", "anchored");
    renderWidget();
    fireEvent.click(screen.getByLabelText("Open the Atlas agent"));
    expect(document.body.classList.contains("rlc-anchored")).toBe(true);
    fireEvent.click(screen.getByText("close-panel"));
    expect(document.body.classList.contains("rlc-anchored")).toBe(false);
  });
});

describe("ChatWidget citation navigation", () => {
  it("navigates the SPA route on an onAtlas citation click, keeping the panel open", () => {
    renderWidget();
    fireEvent.click(screen.getByLabelText("Open the Atlas agent"));
    fireEvent.click(screen.getByText("cite"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/atlas");
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });
});
