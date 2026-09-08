// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NewMessagesPill } from "./NewMessagesPill";

afterEach(cleanup);

describe("NewMessagesPill", () => {
  it("reports finished text below", () => {
    render(<NewMessagesPill onClick={vi.fn()} streaming={false} />);
    expect(screen.getByRole("button", { name: /new messages below/i })).toBeInTheDocument();
  });

  // Mid-answer the text below is still being written, so "New messages" would
  // read as a second reply having arrived.
  it("reports a reply still being written", () => {
    render(<NewMessagesPill onClick={vi.fn()} streaming />);
    expect(screen.getByRole("button", { name: /still writing below/i })).toBeInTheDocument();
  });

  it("calls back on click", () => {
    const onClick = vi.fn();
    render(<NewMessagesPill onClick={onClick} streaming={false} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
