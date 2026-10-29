// @vitest-environment jsdom
// The rate-limit section's link to the audit report: one deployment's item
// count (a row with no kind counts on every deployment of its chain), linking
// to the report filtered to the Prime.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const row = (item: string, primeId: string, chain: string, kind: string | null) => ({ item, primeId, chain, kind });
vi.mock("../../lib/pauAudit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/pauAudit")>()),
  loadPauAuditItems: () =>
    Promise.resolve([
      row("a", "p1", "ethereum", "monolithic"), row("a", "p1", "ethereum", "monolithic"), row("b", "p1", "ethereum", null),
      row("c", "p1", "ethereum", "diamond"), row("d", "p1", "base", "monolithic"), row("e", "p2", "ethereum", "monolithic"),
    ]),
}));

import { PauAuditLink } from "./PauAuditLink";

afterEach(cleanup);

describe("PauAuditLink", () => {
  it("counts the deployment's items once each, with the chain's kindless ones, and links to the report filtered to the Prime", async () => {
    render(<PauAuditLink primeId="p1" primeName="Spark Prime" chain="ethereum" kind="monolithic" />);
    expect(await screen.findByRole("link", { name: "2 values to review" })).toHaveAttribute("href", "/reports/pau-audit?prime=Spark%20Prime");
  });
  it("shows nothing for a deployment with none", async () => {
    const { container } = render(<PauAuditLink primeId="p3" primeName="Keel" chain="ethereum" kind="monolithic" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
