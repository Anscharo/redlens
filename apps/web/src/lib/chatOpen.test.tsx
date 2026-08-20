// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChatOpenProvider, useChatOpen } from "./chatOpen";

function Probe() {
  const { request, openChat } = useChatOpen();
  return (
    <div>
      <div data-testid="request">
        {request ? `${request.conversationId}:${request.title ?? ""}:${request.nonce}` : "none"}
      </div>
      <button onClick={() => openChat("c1", "Hello")}>open-c1</button>
      <button onClick={() => openChat("c2")}>open-c2</button>
    </div>
  );
}

afterEach(cleanup);

describe("ChatOpenProvider / useChatOpen", () => {
  it("throws when used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useChatOpen must be used within <ChatOpenProvider>");
    spy.mockRestore();
  });

  it("starts with no request", () => {
    render(
      <ChatOpenProvider>
        <Probe />
      </ChatOpenProvider>,
    );
    expect(screen.getByTestId("request")).toHaveTextContent("none");
  });

  it("openChat sets the request with the given id/title and nonce 1", () => {
    render(
      <ChatOpenProvider>
        <Probe />
      </ChatOpenProvider>,
    );
    fireEvent.click(screen.getByText("open-c1"));
    expect(screen.getByTestId("request")).toHaveTextContent("c1:Hello:1");
  });

  it("openChat with no title defaults title to null", () => {
    render(
      <ChatOpenProvider>
        <Probe />
      </ChatOpenProvider>,
    );
    fireEvent.click(screen.getByText("open-c2"));
    expect(screen.getByTestId("request")).toHaveTextContent("c2::1");
  });

  it("re-clicking the SAME conversation id produces a NEW nonce", () => {
    render(
      <ChatOpenProvider>
        <Probe />
      </ChatOpenProvider>,
    );
    fireEvent.click(screen.getByText("open-c1"));
    expect(screen.getByTestId("request")).toHaveTextContent("c1:Hello:1");
    fireEvent.click(screen.getByText("open-c1"));
    expect(screen.getByTestId("request")).toHaveTextContent("c1:Hello:2");
  });
});
