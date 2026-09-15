// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SupersededAnswer } from "./SupersededAnswer";
import type { SupersededDraft } from "./useChatStream";

afterEach(cleanup);

const noop = () => {};
const draft = (text: string, reason: SupersededDraft["reason"] = "tool_round"): SupersededDraft => ({ text, reason, round: 1 });

describe("SupersededAnswer", () => {
  it("renders nothing when no draft was kept", () => {
    const { container } = render(<SupersededAnswer drafts={[]} onAtlas={noop} />);
    expect(container).toBeEmptyDOMElement();
  });

  // A tool_round draft was never judged wrong — <del> would announce a
  // retraction that did not happen. Dimmed italic via CSS; markup is a plain
  // wrapper with a note.
  it("does not strike a tool_round draft", () => {
    const { container } = render(
      <SupersededAnswer drafts={[draft("let me look that up")]} onAtlas={noop} />,
    );
    expect(container.querySelector("del")).toBeNull();
    const body = container.querySelector('[data-reason="tool_round"] .rlc-superseded-text');
    expect(body?.tagName).toBe("DIV");
    expect(body).toHaveTextContent("let me look that up");
  });

  it("is one root so caller props are not copied onto every draft", () => {
    const { container } = render(
      <SupersededAnswer
        drafts={[draft("preamble"), draft("more")]}
        onAtlas={noop}
        data-testid="kept"
      />,
    );
    expect(container.querySelectorAll('[data-testid="kept"]')).toHaveLength(1);
    expect(container.firstElementChild).toHaveClass("rlc-superseded-list");
  });

  it("labels the block for assistive tech", () => {
    render(<SupersededAnswer drafts={[draft("d")]} onAtlas={noop} />);
    expect(screen.getAllByLabelText("An earlier draft, replaced later in this answer")).toHaveLength(1);
  });

  it("gives the tool_round reason its own note and data-reason", () => {
    const { container } = render(<SupersededAnswer drafts={[draft("preamble")]} onAtlas={noop} />);
    expect(container.querySelectorAll(".rlc-superseded")).toHaveLength(1);
    expect(container.querySelector('[data-reason="tool_round"]')).toHaveTextContent(/set this aside to keep searching/);
  });

  it("keeps drafts in arrival order, oldest first", () => {
    const { container } = render(
      <SupersededAnswer drafts={[draft("first"), draft("second")]} onAtlas={noop} />,
    );
    const texts = [...container.querySelectorAll(".rlc-superseded-text")].map((n) => n.textContent);
    expect(texts).toEqual(["first", "second"]);
  });

  // The whole point of keeping the draft is that it stays readable. Plain text
  // would hand back raw source for something the reader saw fully rendered.
  it("renders the draft as markdown, not raw source", () => {
    const { container } = render(
      <SupersededAnswer drafts={[draft("a threshold of **7 signers** applies")]} onAtlas={noop} />,
    );
    const body = container.querySelector("div.rlc-superseded-text");
    expect(body?.querySelector("strong")).toHaveTextContent("7 signers");
    expect(body).not.toHaveTextContent("**7 signers**");
  });

  it("renders a draft's paragraph checks under its text", () => {
    const withChecks: SupersededDraft = {
      ...draft("a preamble"),
      checks: [{ index: 0, text: "a preamble", findings: ["flagged claim"] }],
    };
    const { container } = render(<SupersededAnswer drafts={[withChecks]} onAtlas={noop} />);
    expect(container.querySelector(".rlc-para-checks")).toBeInTheDocument();
    expect(container.querySelector('[data-reason="tool_round"] .rlc-para-checks')).toBeInTheDocument();
  });

  it("renders no paragraph checks for a draft that has none", () => {
    const { container } = render(<SupersededAnswer drafts={[draft("plain preamble")]} onAtlas={noop} />);
    expect(container.querySelector(".rlc-para-checks")).toBeNull();
  });

  it("keeps the kept draft's atlas citations followable", async () => {
    const onAtlas = vi.fn();
    render(
      <SupersededAnswer
        drafts={[draft("see [Threshold Requirements](/atlas/3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607)")]}
        onAtlas={onAtlas}
      />,
    );
    await userEvent.click(screen.getByRole("link", { name: "Threshold Requirements" }));
    expect(onAtlas).toHaveBeenCalledWith("3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607");
  });
});
