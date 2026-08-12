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
import { installInteractionCapture, resetInteractions } from "../../lib/lastInteraction";

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
  fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
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

  it("keeps the search-syntax reference link — the keyboard list went, this stayed", () => {
    render(<FeedbackButton />);
    openViaButton();
    const link = screen.getByRole("link", { name: /search syntax reference/i });
    expect(link).toHaveAttribute("href", "/search-hints");
    // No keyboard-shortcut list alongside it.
    expect(document.querySelectorAll('[role="dialog"] kbd')).toHaveLength(0);
  });

  it("keeps that link reachable in the thank-you state too", async () => {
    mockFetch(jsonResponse({ ok: true, id: "f3" }, 201));
    render(<FeedbackButton />);
    openViaButton();
    fillAndSend();
    await waitFor(() => expect(screen.getByText(/thanks/i)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /search syntax reference/i })).toBeInTheDocument();
  });

  it("does not auto-close on success — the thank-you is read, not flashed past", async () => {
    mockFetch(jsonResponse({ ok: true, id: "f2" }, 201));
    render(<FeedbackButton />);
    openViaButton();
    fillAndSend();
    await waitFor(() => expect(screen.getByText(/thanks/i)).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The form is replaced in place rather than the dialog closing.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

// The trail records what the user was doing BEFORE the modal opened. Two
// things must never appear in it: the click that opened it (excluded at the
// source by the button's data-feedback-ui marker), and anything they do inside
// the form (excluded by freezing the trail at mount).
describe("interaction trail", () => {
  it("sends the pre-open trail, excluding the trigger and everything in the form", async () => {
    const stop = installInteractionCapture();
    resetInteractions();
    try {
      // Something the user did beforehand.
      const before = document.createElement("a");
      before.setAttribute("href", "/reports");
      before.textContent = "Reports";
      document.body.appendChild(before);
      before.dispatchEvent(new Event("pointerdown", { bubbles: true }));

      const fetchMock = mockFetch(jsonResponse({ ok: true, id: "f9" }, 201));
      render(<FeedbackButton />);

      // Dispatch real pointer/focus events, not just fireEvent.click — which
      // emits neither, and would let these assertions pass vacuously.
      const trigger = screen.getByRole("button", { name: "Send feedback" });
      trigger.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      openViaButton();

      // …and inside the form, after the freeze. Deliberately the cancel
      // button, NOT the textarea: the textarea carries .ph-no-capture, so it
      // is excluded for an unrelated reason and would prove nothing here.
      const cancel = screen.getByRole("button", { name: "cancel" });
      cancel.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      cancel.dispatchEvent(new Event("focusin", { bubbles: true }));

      fillAndSend();
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const sent = JSON.parse(init.body as string);
      const trail: string[] = sent.context.interactions;

      expect(trail).toHaveLength(1);
      expect(trail[0]).toContain("[href=/reports]");
      expect(trail.join(" ")).not.toContain("Send feedback"); // the trigger
      expect(trail.join(" ")).not.toContain("cancel"); // anything after the freeze
      before.remove();
    } finally {
      stop();
    }
  });
});
