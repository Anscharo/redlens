// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { SettlementsBundle } from "../../lib/settlements";

const FIXTURE: SettlementsBundle = {
  source: { repo: "soterlabs/settlement-reports" },
  reports: [
    {
      prime: "spark",
      month: "2026-06",
      settleVersion: "0.4.0",
      generatedAt: null,
      period: null,
      headline: { primeAgentRevenue: 20, skyRevenue: 10, profitToGrove: 5, cof: 8, sdeRevenue: 2 },
      venues: [],
    },
    {
      prime: "spark",
      month: "2026-07",
      settleVersion: "0.4.0",
      generatedAt: null,
      period: null,
      headline: { primeAgentRevenue: 200, skyRevenue: 100, profitToGrove: 40, cof: 50, sdeRevenue: 50 },
      venues: [],
    },
  ],
};

vi.mock("../../lib/settlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settlements")>();
  return { ...actual, loadSettlements: () => Promise.resolve(FIXTURE) };
});

import { ActorSettlementTeaser } from "./ActorSettlementTeaser";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/radar/spark");
});

describe("ActorSettlementTeaser", () => {
  it("shows the latest month's amount to Sky and links to the full cycle page", async () => {
    render(<ActorSettlementTeaser slug="spark" />);
    await waitFor(() => expect(screen.getByText("$100 to Sky")).toBeInTheDocument());
    expect(screen.getByText("Jul 2026")).toBeInTheDocument();
    expect(screen.queryByText("$10 to Sky")).not.toBeInTheDocument();
    const figure = screen.getByText("$100 to Sky");
    const link = screen.getByRole("link", { name: /full cycle/ });
    expect(link).toHaveAttribute("href", "/radar/spark/settlements");
    expect(figure.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(figure.closest(".msc-teaser")).toBeTruthy();
    expect(screen.getByTestId("msc-teaser")).toBe(figure.closest(".msc-teaser"));
  });

  it("treats the composite-party slug as the prime", async () => {
    render(<ActorSettlementTeaser slug="spark-party" />);
    await waitFor(() => expect(screen.getByText("$100 to Sky")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /full cycle/ })).toHaveAttribute(
      "href",
      "/radar/spark-party/settlements",
    );
  });

  it("renders nothing for a slug with no MSC workbooks", async () => {
    const { rerender } = render(<ActorSettlementTeaser slug="spark" />);
    await screen.findByText("$100 to Sky");
    rerender(<ActorSettlementTeaser slug="spark-proxy" />);
    expect(screen.queryByRole("heading", { name: "Monthly settlement" })).not.toBeInTheDocument();
  });
});
