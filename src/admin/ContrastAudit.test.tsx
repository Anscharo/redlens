// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ContrastAudit } from "./ContrastAudit";
import { AUDIT_PAIRS } from "./contrast";

afterEach(() => cleanup());

describe("ContrastAudit", () => {
  it("renders exactly one row per AUDIT_PAIRS entry", () => {
    render(<ContrastAudit effectiveValue={() => "#000000"} />);
    for (const { label } of AUDIT_PAIRS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Every pair here resolves to black-on-black, so all should read "1.00 / Fail".
    expect(screen.getAllByText("1.00")).toHaveLength(AUDIT_PAIRS.length);
  });

  it("rates a known high-contrast pair correctly (black text on white)", () => {
    const values: Record<string, string> = { tan: "#000000", bg: "#ffffff" };
    render(<ContrastAudit effectiveValue={(name) => values[name] ?? "#000000"} />);
    expect(screen.getByText("primary text / bg").closest("div")).toHaveTextContent("21.00");
    expect(screen.getByText("primary text / bg").closest("div")).toHaveTextContent("AAA");
  });

  it("shows placeholders instead of a ratio when a value isn't a plain hex color", () => {
    render(<ContrastAudit effectiveValue={() => "rgba(0, 0, 0, 0.5)"} />);
    const row = screen.getByText("primary text / bg").closest("div")!;
    expect(row).toHaveTextContent("—");
  });
});
