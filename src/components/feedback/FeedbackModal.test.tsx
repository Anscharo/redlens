// @vitest-environment jsdom
//
// Renders <FeedbackButton/> (which owns the open/close state + the global "?"
// listener) rather than <FeedbackModal/> directly, since the "?" keybinding
// and the honeypot/submit flow are only observable together — mirrors
// ChatWidget.test.tsx's convention of mocking pageContext wholesale to avoid
// a wouter Router wrapper.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PageContextView } from "../chat/pageContext";

const context: PageContextView = {
  path: "/atlas?id=abc",
  nodeId: "abc",
  short: "Ask about this document",
  placeholder: "Ask…",
  label: "Some Doc",
  chip: "atlas · A.1.1",
};
vi.mock("../chat/pageContext", () => ({ usePageContext: () => context }));

import { FeedbackButton } from "./FeedbackButton";

function mockFetch(response: Response) {
  const fn = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openViaButton() {
  fireEvent.click(screen.getByRole("button", { name: "Feedback and shortcuts" }));
}

function fillAndSend(text = "the sidebar is broken on mobile") {
  fireEvent.change(screen.getByLabelText(/what.s broken/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "send" }));
}

describe("? shortcut", () => {
  it("opens the modal when '?' is pressed with document.body focused", () => {
    render(<FeedbackButton />);
    fireEvent.keyDown(document.body, { key: "?" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does NOT open when the event target is an input (typing target)", () => {
    render(
      <>
        <FeedbackButton />
        <input aria-label="some other input" />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("some other input"), { key: "?" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Escape", () => {
  it("closes the modal", () => {
    render(<FeedbackButton />);
    openViaButton();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("honeypot", () => {
  it("renders the website field with tabIndex -1", () => {
    render(<FeedbackButton />);
    openViaButton();
    const hp = document.querySelector('input[name="website"]') as HTMLInputElement | null;
    expect(hp).not.toBeNull();
    expect(hp!.tabIndex).toBe(-1);
  });
});

describe("submit", () => {
  it("POSTs to /api/feedback with message, a console array, and an empty website; a 201 shows the thank-you", async () => {
    const fn = mockFetch(jsonResponse({ ok: true, id: "f1" }, 201));
    render(<FeedbackButton />);
    openViaButton();
    fillAndSend();

    await waitFor(() => expect(screen.getByText(/thanks/i)).toBeInTheDocument());

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/feedback");
    expect(init.credentials).toBe("same-origin");
    const sent = JSON.parse(init.body as string);
    expect(sent.message).toBe("the sidebar is broken on mobile");
    expect(sent.website).toBe("");
    expect(Array.isArray(sent.console)).toBe(true);
  });

  it("a 200 (accepted-but-discarded) shows the thank-you exactly like a 201", async () => {
    mockFetch(jsonResponse({ ok: true }, 200));
    render(<FeedbackButton />);
    openViaButton();
    fillAndSend();
    await waitFor(() => expect(screen.getByText(/thanks/i)).toBeInTheDocument());
  });

  it("a 429 shows the wait time from retryAfterSeconds", async () => {
    mockFetch(jsonResponse({ error: "rate_limited", retryAfterSeconds: 120 }, 429, { "retry-after": "120" }));
    render(<FeedbackButton />);
    openViaButton();
    fillAndSend();
    await waitFor(() => expect(screen.getByText(/try again in 2 min/i)).toBeInTheDocument());
  });

  it("does not auto-close on success — the shortcuts list stays visible", async () => {
    mockFetch(jsonResponse({ ok: true, id: "f2" }, 201));
    render(<FeedbackButton />);
    openViaButton();
    fillAndSend();
    await waitFor(() => expect(screen.getByText(/thanks/i)).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });
});
