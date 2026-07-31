// @vitest-environment jsdom
import { it, expect, describe, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProvenancePage } from "./ProvenancePage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProvenancePage", () => {
  it("sets the document title", () => {
    render(<ProvenancePage />);
    expect(document.title).toBe("Provenance: Sky Atlas by Redline");
  });

  it("renders the current data flow and supporting sources", () => {
    render(<ProvenancePage />);

    expect(
      screen.getByRole("heading", { name: /Data flow & provenance/, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("The data flow has 6 stages:")).toBeInTheDocument();

    const labels = [
      "parse atlas",
      "derive relationships",
      "enrich addresses",
      "snapshot chain state",
      "assemble history",
      "publish & verify",
    ];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Numbered in order 1..5.
    for (let i = 1; i <= 6; i++) {
      expect(screen.getByText(`${i}.`)).toBeInTheDocument();
    }

    // Spot-check one stage's description and powers list rendered together.
    expect(
      screen.getByText(
        /Applies documented, pattern-based extractors to Atlas text/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Constellations graph/)).toBeInTheDocument();
  });

  it("explains both reconstructed history eras", () => {
    render(<ProvenancePage />);
    expect(
      screen.getByRole("heading", { name: "History provenance" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/History before pull request #117 is reconstructed/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Earlier entries are origin evidence, not a continuous changelog/,
      ),
    ).toBeInTheDocument();
  });
});
