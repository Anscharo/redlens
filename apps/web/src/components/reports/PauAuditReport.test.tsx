// @vitest-environment jsdom
// The PAU audit report: a section per group with its item count and hint, the
// group and prime pills (URL-synced), the header search, and a cited atlas
// document per row.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { AuditRow } from "@/lib/pauAuditIndex";

const row = (over: Partial<AuditRow>): AuditRow => ({
  item: "value:d1:slope", group: "atlas", reason: "switched-off-slope", note: "The limit is switched off on both sides.", primeId: "p1", prime: "Spark",
  chain: "ethereum", kind: "monolithic", subject: "Ethereum Mainnet - Aave Core USDC", label: "Inflow slope", stated: "25,000,000 USDC per day", onchain: "0 USDC per day",
  docId: "d1", key: "0xk", contract: "0xc", chainSetAt: "2026-04-01", atlasChangedAt: "2026-03-01", ...over,
});
const rows: AuditRow[] = [
  row({}),
  row({ item: "value:d2:maxAmount", group: "spell", reason: "atlas-newer", prime: "Grove", primeId: "p2", subject: "Morpho Vault", label: "Deposit maxAmount", docId: "d2", note: "The atlas document changed after the chain value was last set." }),
  row({ item: "value:d2:maxAmount", group: "spell", reason: "atlas-newer", prime: "Grove", primeId: "p2", subject: "Morpho Vault", label: "Deposit maxAmount", docId: "d2", kind: "diamond", note: "The atlas document changed after the chain value was last set." }),
  row({ item: "claim:x", group: "registry", reason: "rejected-claim", prime: "Shared", primeId: null, subject: "Atlas role claim", label: "beacon", stated: "0x10e6593cdda8c58a1d0f14c5164b376352a55f2f", onchain: "", docId: "d3", note: "It is the Governance Relay." }),
];

vi.mock("../../lib/pauAudit", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/pauAudit")>()), loadPauAudit: () => Promise.resolve(rows) }));
vi.mock("../../lib/docs", () => ({ loadDocs: () => Promise.resolve({ d1: { doc_no: "A.6.1" }, d2: { doc_no: "A.6.2" }, d3: { doc_no: "A.2.2" } }) }));

import { PauAuditReport } from "./PauAuditReport";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("PauAuditReport", () => {
  it("shows each group with its item count and hint, and cites each row's atlas document", async () => {
    render(<PauAuditReport query="" mode="broad" />);
    const spell = await screen.findByRole("region", { name: /Spell may not have executed yet/ });
    expect(within(spell).getByRole("heading", { level: 2 })).toHaveTextContent("· 1");
    expect(within(spell).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("region", { name: /Atlas probably out of date/ })).toHaveTextContent("chain set 2026-04-01 · atlas changed 2026-03-01");
    expect(screen.getByRole("link", { name: "A.6.1" })).toHaveAttribute("href", expect.stringContaining("d1"));
    expect(screen.queryByRole("region", { name: /Ambiguous/ })).toBeNull();
    expect(screen.getByText("3 items", { exact: false })).toBeInTheDocument();
  });

  it("narrows by group and prime pills, and by the header search", async () => {
    render(<PauAuditReport query="" mode="broad" />);
    fireEvent.click(await screen.findByRole("button", { name: /Registry conflicts/ }));
    expect(window.location.search).toContain("group=registry");
    expect(screen.queryByRole("region", { name: /Atlas probably out of date/ })).toBeNull();
    cleanup();
    window.history.pushState({}, "", "/?prime=Grove");
    render(<PauAuditReport query="" mode="broad" />);
    expect(await screen.findByRole("region", { name: /Spell may not have executed yet/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Registry conflicts/ })).toBeNull();
    cleanup();
    window.history.pushState({}, "", "/");
    render(<PauAuditReport query="Aave" mode="broad" />);
    expect(await screen.findByRole("region", { name: /Atlas probably out of date/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Spell may not have executed yet/ })).toBeNull();
  });
});
