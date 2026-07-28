// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Message } from "./Message";
import type { ChatMsg } from "./useChatStream";

vi.mock("../../lib/docs", () => ({ loadAtlas: () => Promise.resolve({ docs: {} }) }));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));

afterEach(cleanup);

function baseMsg(over: Partial<ChatMsg>): ChatMsg {
  return { role: "assistant", content: "", trace: [], rounds: 0, sources: [], done: false, ...over };
}

describe("Message", () => {
  it("renders a user turn as plain text in a bubble", () => {
    render(
      <Message msg={{ ...baseMsg({}), role: "user", content: "hi there" }} streaming={false} showTrace={false} onAtlas={vi.fn()} />,
    );
    expect(screen.getByText("you")).toBeInTheDocument();
    expect(screen.getByText("hi there")).toBeInTheDocument();
  });

  it("shows a thinking placeholder for a streaming assistant turn with no content yet", () => {
    render(
      <Message
        msg={baseMsg({ content: "", statusLine: "searching…" })}
        streaming
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("searching…")).toBeInTheDocument();
  });

  it("defaults the thinking placeholder text when no statusLine is set", () => {
    render(<Message msg={baseMsg({ content: "" })} streaming showTrace={false} onAtlas={vi.fn()} />);
    expect(screen.getByText("searching the stars…")).toBeInTheDocument();
  });

  it("renders markdown content plus a caret and status line while streaming with content", () => {
    render(
      <Message
        msg={baseMsg({ content: "partial answer", statusLine: "reading…" })}
        streaming
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("partial answer")).toBeInTheDocument();
    expect(screen.getByText("reading…")).toBeInTheDocument();
    expect(document.querySelector(".rlc-caret")).toBeInTheDocument();
  });

  it("shows Sources once done and not streaming, using content-derived citations", () => {
    render(
      <Message
        msg={baseMsg({
          content: "See [Doc](/atlas/11111111-1111-1111-1111-111111111111)",
          done: true,
        })}
        streaming={false}
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("sources · 1")).toBeInTheDocument();
  });

  it("shows the ToolTrace when showTrace is true and there is a trace", () => {
    render(
      <Message
        msg={baseMsg({ trace: [{ name: "atlas_get", args: {}, ok: true, bytes: 10 }], rounds: 1 })}
        streaming={false}
        showTrace
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("looked up 1 thing over the atlas")).toBeInTheDocument();
  });

  it("hides the ToolTrace when showTrace is false even with a trace present", () => {
    render(
      <Message
        msg={baseMsg({ trace: [{ name: "atlas_get", args: {}, ok: true, bytes: 10 }], rounds: 1 })}
        streaming={false}
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.queryByText("looked up 1 thing over the atlas")).toBeNull();
  });

  it("shows a distinct failed-turn notice for a done, empty, failed assistant message", () => {
    render(<Message msg={baseMsg({ content: "", done: true, failed: true })} streaming={false} showTrace={false} onAtlas={vi.fn()} />);
    expect(screen.getByText(/This reply didn.t come through/)).toBeInTheDocument();
    expect(document.querySelector(".rlc-turn-error")).toBeInTheDocument();
  });

  it("does not show the failed-turn notice once real content has arrived, even if failed lingers", () => {
    render(
      <Message msg={baseMsg({ content: "an actual answer", done: true, failed: true })} streaming={false} showTrace={false} onAtlas={vi.fn()} />,
    );
    expect(screen.queryByText(/This reply didn.t come through/)).toBeNull();
    expect(screen.getByText("an actual answer")).toBeInTheDocument();
  });

  it("prefers the thinking placeholder over the failed notice while still streaming", () => {
    render(<Message msg={baseMsg({ content: "", failed: true })} streaming showTrace={false} onAtlas={vi.fn()} />);
    expect(screen.getByText("searching the stars…")).toBeInTheDocument();
    expect(screen.queryByText(/This reply didn.t come through/)).toBeNull();
  });

  it("shows a VerifyBadge when the message carries a verify state", () => {
    render(
      <Message
        msg={baseMsg({
          verify: {
            status: "pass",
            claims: [],
            invalidCitations: [],
            invalidDocNos: [],
            docNoMismatches: [],
            ungroundedQuotes: [],
            ungroundedAddresses: [],
          },
        })}
        streaming={false}
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("verified against the atlas")).toBeInTheDocument();
  });
});
