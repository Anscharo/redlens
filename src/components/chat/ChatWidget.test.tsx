// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { PageContextView } from "./pageContext";
import type { ChatEvent } from "./api";
import type { ChatSession } from "./useChatSession";

const context: PageContextView = {
  short: "Ask the Sky Atlas",
  placeholder: "Ask…",
  label: "Sky Atlas",
  chip: "atlas",
};
vi.mock("./pageContext", () => ({ usePageContext: () => context }));

const authUser = { id: "u1", name: "Ada", avatarUrl: "a.png", provider: "github", email: null };
vi.mock("./auth", () => ({ useAuth: () => ({ user: authUser, openAuth: vi.fn() }) }));
// useChatSession composes the real useUsage — stub it out so tests don't need
// to mock /api/usage; only /api/chat (and, for hydrate tests, getConversation)
// are exercised for real.
vi.mock("./useUsage", () => ({ useUsage: () => ({ usage: null, commons: null, refresh: vi.fn() }) }));

const { getConversation } = vi.hoisted(() => ({ getConversation: vi.fn() }));
vi.mock("../../lib/conversationsApi", () => ({ getConversation }));

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../lib/analytics", () => ({ track }));

// A purpose-built fake standing in for the real ChatPanel: it renders exactly
// what these tests need to assert on (placement, session.title, session's
// live message list) and exposes the session's own actions as buttons,
// rather than pulling in the full Message/markdown/Composer rendering stack
// — that's ChatPanel's own test's job, not ChatWidget's.
vi.mock("./ChatPanel", () => ({
  ChatPanel: ({
    session,
    onClose,
    onAtlas,
    placement,
    onTogglePlacement,
  }: {
    session: ChatSession;
    onClose: () => void;
    onAtlas: (uuid: string) => void;
    placement: string;
    onTogglePlacement: () => void;
  }) => (
    <div data-testid="chat-panel">
      <span data-testid="placement">{placement}</span>
      <span data-testid="title">{session.title ?? ""}</span>
      <ul data-testid="messages">
        {session.messages.map((m, i) => (
          <li key={i}>{m.content}</li>
        ))}
      </ul>
      <button onClick={() => void session.send("hello")}>send</button>
      <button onClick={onClose}>close-panel</button>
      <button onClick={() => onAtlas("11111111-1111-1111-1111-111111111111")}>cite</button>
      <button onClick={onTogglePlacement}>toggle-placement</button>
    </div>
  ),
}));

import { ChatWidget } from "./ChatWidget";
import { ChatOpenProvider, useChatOpen } from "../../lib/chatOpen";

function LocationProbe() {
  const [loc] = useLocation();
  return <p data-testid="loc">{loc}</p>;
}

// Test-only sibling that drives the real ChatOpenProvider, standing in for a
// conversation-list row (out of scope here) that calls openChat(id, title).
function OpenTrigger({ id, title }: { id: string; title?: string | null }) {
  const { openChat } = useChatOpen();
  return <button onClick={() => openChat(id, title)}>open-conv</button>;
}

function DeleteTrigger({ id }: { id: string }) {
  const { notifyDeleted } = useChatOpen();
  return <button onClick={() => notifyDeleted(id)}>delete-conv</button>;
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

function sse(events: ChatEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const ev of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      controller.close();
    },
  });
}

beforeEach(() => {
  localStorage.clear();
  document.body.className = "";
  getConversation.mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.className = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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

describe("ChatWidget conversation memory", () => {
  it("keeps the thread across close → reopen (state lives in the widget, not the panel)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            sse([
              { type: "meta", conversationId: "c1" },
              { type: "token", text: "Hello reply" },
              { type: "done", content: "Hello reply", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
            ]),
            { status: 200 },
          ),
        ),
      ),
    );

    renderWidget();
    fireEvent.click(screen.getByLabelText("Open the Atlas agent"));
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByTestId("messages")).toHaveTextContent("Hello reply"));

    // Close unmounts ChatPanel (and this fake) entirely.
    fireEvent.click(screen.getByText("close-panel"));
    expect(screen.queryByTestId("chat-panel")).toBeNull();

    // Reopen: a fresh ChatPanel mounts, but it's handed the SAME session.
    fireEvent.click(screen.getByLabelText("Open the Atlas agent"));
    expect(screen.getByTestId("messages")).toHaveTextContent("Hello reply");
  });

  it("tolerates rendering without a mounted <ChatOpenProvider>", () => {
    expect(() => renderWidget()).not.toThrow();
    expect(screen.getByLabelText("Open the Atlas agent")).toBeInTheDocument();
  });

  it("a useChatOpen request opens the panel and hydrates the requested conversation", async () => {
    getConversation.mockResolvedValue({
      id: "conv-9",
      title: "Old thread",
      updatedAt: "2026-01-01T00:00:00Z",
      messages: [{ role: "assistant", content: "Restored answer", createdAt: "2026-01-01T00:00:00Z", toolCalls: null }],
    });
    const { hook } = memoryLocation({ path: "/", record: true });
    render(
      <Router hook={hook}>
        <ChatOpenProvider>
          <ChatWidget />
          <OpenTrigger id="conv-9" title="Old thread" />
        </ChatOpenProvider>
      </Router>,
    );

    expect(screen.queryByTestId("chat-panel")).toBeNull();
    fireEvent.click(screen.getByText("open-conv"));

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(screen.getByTestId("title")).toHaveTextContent("Old thread");
    await waitFor(() => expect(screen.getByTestId("messages")).toHaveTextContent("Restored answer"));
    expect(getConversation).toHaveBeenCalledWith("conv-9");
  });

  it("a repeat request for the same conversation re-fires on a new nonce", async () => {
    getConversation.mockResolvedValue({
      id: "conv-9",
      title: "Old thread",
      updatedAt: "2026-01-01T00:00:00Z",
      messages: [],
    });
    const { hook } = memoryLocation({ path: "/", record: true });
    render(
      <Router hook={hook}>
        <ChatOpenProvider>
          <ChatWidget />
          <OpenTrigger id="conv-9" title="Old thread" />
        </ChatOpenProvider>
      </Router>,
    );

    fireEvent.click(screen.getByText("open-conv"));
    await waitFor(() => expect(getConversation).toHaveBeenCalledTimes(1));

    // Same id, second click — a naive id-comparison would swallow this.
    fireEvent.click(screen.getByText("open-conv"));
    await waitFor(() => expect(getConversation).toHaveBeenCalledTimes(2));
  });

  it("clears the thread when the OPEN conversation is deleted elsewhere", async () => {
    getConversation.mockResolvedValue({
      id: "conv-9",
      title: "Old thread",
      updatedAt: "2026-01-01T00:00:00Z",
      messages: [{ role: "assistant", content: "Restored answer", createdAt: "2026-01-01T00:00:00Z", toolCalls: null }],
    });
    const { hook } = memoryLocation({ path: "/", record: true });
    render(
      <Router hook={hook}>
        <ChatOpenProvider>
          <ChatWidget />
          <OpenTrigger id="conv-9" title="Old thread" />
          <DeleteTrigger id="conv-9" />
        </ChatOpenProvider>
      </Router>,
    );

    fireEvent.click(screen.getByText("open-conv"));
    await waitFor(() => expect(screen.getByTestId("messages")).toHaveTextContent("Restored answer"));

    fireEvent.click(screen.getByText("delete-conv"));
    await waitFor(() => expect(screen.getByTestId("messages")).not.toHaveTextContent("Restored answer"));
  });

  it("leaves the thread alone when a DIFFERENT conversation is deleted", async () => {
    getConversation.mockResolvedValue({
      id: "conv-9",
      title: "Old thread",
      updatedAt: "2026-01-01T00:00:00Z",
      messages: [{ role: "assistant", content: "Restored answer", createdAt: "2026-01-01T00:00:00Z", toolCalls: null }],
    });
    const { hook } = memoryLocation({ path: "/", record: true });
    render(
      <Router hook={hook}>
        <ChatOpenProvider>
          <ChatWidget />
          <OpenTrigger id="conv-9" title="Old thread" />
          <DeleteTrigger id="some-other-conv" />
        </ChatOpenProvider>
      </Router>,
    );

    fireEvent.click(screen.getByText("open-conv"));
    await waitFor(() => expect(screen.getByTestId("messages")).toHaveTextContent("Restored answer"));

    fireEvent.click(screen.getByText("delete-conv"));
    expect(screen.getByTestId("messages")).toHaveTextContent("Restored answer");
  });
});
