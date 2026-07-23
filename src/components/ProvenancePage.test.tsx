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

  it("renders the heading and all 5 pipeline stages in order with their powers", () => {
    render(<ProvenancePage />);

    expect(screen.getByRole("heading", { name: /Data flow & provenance/, level: 1 })).toBeInTheDocument();
    expect(screen.getByText("The pipeline runs 5 stages in order:")).toBeInTheDocument();

    const labels = ["parse", "enrich addresses", "snapshot chain state", "atlas history", "build graph"];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Numbered in order 1..5.
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByText(`${i}.`)).toBeInTheDocument();
    }

    // Spot-check one stage's description and powers list rendered together.
    expect(
      screen.getByText(/Extracts typed relationships from the atlas text/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Constellations — visual graph of agents/)).toBeInTheDocument();
  });
});
