// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SupersededAnswer } from "./SupersededAnswer";
import type { SupersededDraft } from "./useChatStream";

afterEach(cleanup);

const noop = () => {};
const draft = (text: string, reason: SupersededDraft["reason"] = "revision"): SupersededDraft => ({ text, reason });

describe("SupersededAnswer", () => {
  it("renders nothing when no draft was kept", () => {
    const { container } = render(<SupersededAnswer drafts={[]} onAtlas={noop} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks a rejected revision as <del>, with an inline plain-language note", () => {
    const { container } = render(
      <SupersededAnswer drafts={[draft("an earlier, incorrect answer")]} onAtlas={noop} />,
    );
    const caption = screen.getByText(/A verification check found problems with this draft/);
    expect(caption).toBeInTheDocument();
    expect(caption).toHaveClass("rlc-superseded-note");
    const del = container.querySelector("del.rlc-superseded-text");
    expect(del).toHaveTextContent("an earlier, incorrect answer");
  });

  // A tool_round draft was never judged wrong — <del> would announce
  // retraction that did not happen. Dimmed italic via CSS; markup is a note.
  it("does not strike a tool_round draft", () => {
    const { container } = render(
      <SupersededAnswer drafts={[draft("let me look that up", "tool_round")]} onAtlas={noop} />,
    );
    expect(container.querySelector("del")).toBeNull();
    const body = container.querySelector('[data-reason="tool_round"] .rlc-superseded-text');
    expect(body?.tagName).toBe("DIV");
    expect(body).toHaveTextContent("let me look that up");
  });

  it("is one root so caller props are not copied onto every draft", () => {
    const { container } = render(
      <SupersededAnswer
        drafts={[draft("preamble", "tool_round"), draft("bad", "revision")]}
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

  // Each reason has to say WHY that block stopped being the answer — a
  // rejected draft and preamble-before-a-search are not the same event.
  it("gives each reason its own note and its own data-reason", () => {
    const { container } = render(
      <SupersededAnswer drafts={[draft("preamble", "tool_round"), draft("bad", "revision")]} onAtlas={noop} />,
    );
    expect(container.querySelectorAll(".rlc-superseded")).toHaveLength(2);
    expect(container.querySelector('[data-reason="tool_round"]')).toHaveTextContent(/set this aside to keep searching/);
    expect(container.querySelector('[data-reason="revision"]')).toHaveTextContent(/verification check found problems/);
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
    const del = container.querySelector("del.rlc-superseded-text");
    expect(del?.querySelector("strong")).toHaveTextContent("7 signers");
    expect(del).not.toHaveTextContent("**7 signers**");
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
