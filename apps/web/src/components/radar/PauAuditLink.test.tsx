// @vitest-environment jsdom
// The PAU page's link to the audit report: this Prime's item count, filtered to it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../../lib/pauAudit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/pauAudit")>()),
  loadPauAudit: () => Promise.resolve([{ item: "a", primeId: "p1" }, { item: "a", primeId: "p1" }, { item: "b", primeId: "p1" }, { item: "c", primeId: "p2" }]),
}));

import { PauAuditLink } from "./PauAuditLink";

afterEach(cleanup);

describe("PauAuditLink", () => {
  it("counts this Prime's items once each and links to the report filtered to it", async () => {
    render(<PauAuditLink primeId="p1" primeName="Spark Prime" />);
    expect(await screen.findByRole("link", { name: "2 PAU values needing audit" })).toHaveAttribute("href", "/reports/pau-audit?prime=Spark%20Prime");
  });
  it("shows nothing for a Prime with none", async () => {
    const { container } = render(<PauAuditLink primeId="p3" primeName="Keel" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
