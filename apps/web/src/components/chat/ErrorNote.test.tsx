// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ErrorNote } from "./ErrorNote";

afterEach(cleanup);

describe("ErrorNote", () => {
  it("renders nothing when message is null", () => {
    const { container } = render(<ErrorNote message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the message and a way forward, with an alert role for screen readers", () => {
    render(<ErrorNote message="the model errored" />);
    const note = screen.getByRole("alert");
    expect(note).toHaveTextContent("the model errored");
    expect(note).toHaveTextContent("send another message to try again");
  });
});
