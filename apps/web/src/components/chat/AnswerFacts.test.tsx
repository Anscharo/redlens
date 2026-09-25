// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AnswerFacts } from "./AnswerFacts";

afterEach(cleanup);

describe("AnswerFacts", () => {
  it("renders nothing when there is nothing to say", () => {
    const { container: a } = render(<AnswerFacts />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(<AnswerFacts coverage={{ verdict: "answers", missingParts: [] }} marks={{}} />);
    expect(b).toBeEmptyDOMElement();
  });

  it("renders a labelled list, one item per fact, with its status as data", () => {
    render(
      <AnswerFacts
        coverage={{ verdict: "answers", missingParts: ["when"] }}
        marks={{ a: { status: "backed", claims: [] }, b: { status: "uncovered", claims: [] } }}
      />,
    );
    const list = screen.getByRole("list", { name: "Answer confidence" });
    const items = screen.getAllByRole("listitem");
    expect(list).toContainElement(items[0]);
    expect(items.map((li) => li.textContent)).toEqual(["Didn't address: “when”", "1 of 2 checked sources backs the answer"]);
    expect(items.map((li) => li.getAttribute("data-status"))).toEqual(["flagged", "info"]);
  });

  it("flags the sources count when a checked source is disputed", () => {
    render(<AnswerFacts marks={{ a: { status: "backed", claims: [] }, b: { status: "disputed", claims: [] } }} />);
    expect(screen.getByText("1 of 2 checked sources backs the answer")).toHaveAttribute("data-status", "flagged");
  });

  it("says a deflecting answer didn't answer the question", () => {
    render(<AnswerFacts coverage={{ verdict: "deflects", missingParts: [] }} />);
    expect(screen.getByText("Didn't answer the question")).toHaveAttribute("data-status", "flagged");
  });

  it("passes native list props through", () => {
    render(<AnswerFacts coverage={{ verdict: "asks", missingParts: [] }} id="facts-1" />);
    expect(screen.getByRole("list")).toHaveAttribute("id", "facts-1");
  });
});
