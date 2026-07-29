// @vitest-environment jsdom
// TargetLinks is exercised indirectly via CrossViewTopicIndex.test.tsx and
// CrossViewMarkdown.test.tsx's `:::index` case, but neither of those drives a
// "compact" grouping where one of the grouped units failed to resolve a
// slug — this is the direct unit-level test for that branch.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TargetLinks } from "./CrossViewIndexTargets";
import type { CrossViewIndexTarget } from "../../lib/crossviewIndex";

afterEach(cleanup);

describe("TargetLinks", () => {
  it("renders a resolved unit target as a link", () => {
    render(<TargetLinks targets={[{ label: "Instruments 1", slug: "instruments-1", kind: "unit" }]} />);
    const link = screen.getByRole("link", { name: "Instruments 1" });
    expect(link).toHaveAttribute("href", "#instruments-1");
  });

  it("renders an unresolved target as plain text in full mode", () => {
    render(<TargetLinks targets={[{ label: "A.4.5", slug: null, kind: "unresolved" }]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("A.4.5")).toBeInTheDocument();
  });

  it("compacts same-family unit targets, linking each resolved number", () => {
    const targets: CrossViewIndexTarget[] = [
      { label: "Economics 3", slug: "economics-3", kind: "unit" },
      { label: "Economics 4", slug: "economics-4", kind: "unit" },
    ];
    render(<TargetLinks targets={targets} />);
    expect(screen.getByText("Economics")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "#economics-3");
    expect(screen.getByRole("link", { name: "4" })).toHaveAttribute("href", "#economics-4");
  });

  it("renders a compact-grouped unit's number as plain text (not a link) when its slug failed to resolve", () => {
    const targets: CrossViewIndexTarget[] = [
      { label: "Economics 3", slug: "economics-3", kind: "unit" },
      { label: "Economics 4", slug: null, kind: "unresolved" },
    ];
    render(<TargetLinks targets={targets} />);
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "#economics-3");
    expect(screen.queryByRole("link", { name: "4" })).not.toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});
