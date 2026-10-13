// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PrimitiveLifecycle } from "./PrimitiveLifecycle";
import { LIFECYCLE_STEPS } from "@/lib/primitiveLifecycle";

afterEach(cleanup);

describe("PrimitiveLifecycle", () => {
  it("walks activation, invocation, active instance and completion in order, named like the page's pills", () => {
    render(<PrimitiveLifecycle />);
    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps.map((li) => li.querySelector("span.mono + span")?.textContent)).toEqual([
      "Global Activation Status: Active",
      "In Progress Invocation",
      "Active Instance",
      "Completed Instance",
    ]);
  });

  it("attributes every quote to the document it comes from, ahead of the quote", () => {
    render(<PrimitiveLifecycle />);
    const quotes = LIFECYCLE_STEPS.flatMap((s) => s.quotes);
    for (const q of quotes) {
      const link = screen.getByRole("link", { name: q.docTitle });
      expect(link).toHaveAttribute("href", expect.stringContaining(q.docId));
      const figure = link.closest("figure")!;
      expect(within(figure).getByText(new RegExp(q.text.slice(0, 30)))).toBeInTheDocument();
    }
  });

  it("marks a quote cut short with an ellipsis", () => {
    render(<PrimitiveLifecycle />);
    expect(screen.getByText(/previously Globally Activated…”/)).toBeInTheDocument();
    expect(screen.getByText(/^“…an instance of a Primitive is fully operational/)).toBeInTheDocument();
  });
});
