// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CategoryPills, categoryCodec } from "./CategoryPills";

afterEach(cleanup);

describe("categoryCodec", () => {
  const labels = { a: "Alpha", b: "Beta" } as const;
  const codec = categoryCodec(labels);

  it("encodes the value unchanged", () => {
    expect(codec.encode("a")).toBe("a");
    expect(codec.encode(null)).toBeNull();
  });

  it("decodes a known key", () => {
    expect(codec.decode("b")).toBe("b");
  });

  it("decodes an unknown key to null", () => {
    expect(codec.decode("nope")).toBeNull();
  });

  it("decodes null to null", () => {
    expect(codec.decode(null)).toBeNull();
  });
});

describe("CategoryPills", () => {
  it("returns null when fewer than 2 categories", () => {
    const { container } = render(
      <CategoryPills categories={["a"]} active={null} onToggle={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for zero categories", () => {
    const { container } = render(
      <CategoryPills categories={[]} active={null} onToggle={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a pill per category with default label and display text", () => {
    render(<CategoryPills categories={["a", "b"]} active={null} onToggle={() => {}} />);
    expect(screen.getByText("Category:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "a" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "b" })).toBeInTheDocument();
  });

  it("uses a custom label and display text", () => {
    render(
      <CategoryPills
        categories={["a", "b"]}
        active={null}
        onToggle={() => {}}
        label="Domain"
        display={{ a: "Alpha" }}
      />,
    );
    expect(screen.getByText("Domain:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "b" })).toBeInTheDocument();
  });

  it("shows a per-pill count when provided", () => {
    render(
      <CategoryPills
        categories={["a", "b"]}
        active={null}
        onToggle={() => {}}
        counts={{ a: 5 }}
      />,
    );
    const btn = screen.getByRole("button", { name: /a/ });
    expect(btn).toHaveTextContent("a(5)");
    expect(screen.getByRole("button", { name: "b" })).toHaveTextContent("b");
  });

  it("shows the trailing hint when provided", () => {
    render(
      <CategoryPills categories={["a", "b"]} active={null} onToggle={() => {}} hint="1=low, 5=high" />,
    );
    expect(screen.getByText("1=low, 5=high")).toBeInTheDocument();
  });

  it("applies the tooltip/underline styling only when labelTitle is set", () => {
    const { rerender } = render(
      <CategoryPills categories={["a", "b"]} active={null} onToggle={() => {}} />,
    );
    expect(screen.getByText("Category:")).not.toHaveAttribute("title");

    rerender(
      <CategoryPills
        categories={["a", "b"]}
        active={null}
        onToggle={() => {}}
        labelTitle="explains the dimension"
      />,
    );
    expect(screen.getByText("Category:")).toHaveAttribute("title", "explains the dimension");
  });

  it("single-select: marks only the active pill and calls onToggle with the key", () => {
    const onToggle = vi.fn();
    render(<CategoryPills categories={["a", "b"]} active="a" onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "a" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "b" })).not.toHaveAttribute("data-active");
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(onToggle).toHaveBeenCalledWith("b");
  });

  it("multi-select: renders a checkmark box per pill and marks every active entry", () => {
    render(<CategoryPills categories={["a", "b", "c"]} active={["a", "c"]} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "a" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "c" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "b" })).not.toHaveAttribute("data-active");
    // checkmark glyph present for the active ones, invisible-classed for inactive
    const bBtn = screen.getByRole("button", { name: "b" });
    expect(bBtn.querySelector("span.invisible")).toBeInTheDocument();
  });
});
