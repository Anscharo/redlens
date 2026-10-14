// @vitest-environment jsdom
// A Diamond PAU's facets in use: alphabetical, each beside the Atlas ceiling
// document (linked, with its amounts, or "not yet stated" where deferred), and
// nothing for a deployment with no integrations.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { StoredPauSnapshot } from "../../lib/pau";

const hex = (s: string) => "0x" + [...s].map((c) => c.charCodeAt(0).toString(16)).join("").padEnd(64, "0");
const at = { block: 1, time: "2026-06-12T15:46:59.000Z", tx: "0x" + "9".repeat(64) };
const integration = (name: string, facet: string) => ({ id: hex(name), config: { facet }, setAt: at });

vi.mock("../../lib/docs", () => ({
  loadAtlas: () => Promise.resolve({ docs: {
    usds: { id: "usds", title: "Highest Production Rate Limit For USDS Facet", content: "- Mint\n    - `maxAmount`: 50,000,000 USDS" },
    cctp: { id: "cctp", title: "Highest Production Rate Limit For CCTP Facet", content: "Further details will be specified in a future iteration of the Atlas." },
  } }),
}));

import { PauFacets } from "./ActorPauFacets";

const snap = (...integrations: ReturnType<typeof integration>[]) =>
  ({ chain: "ethereum", contracts: [{ role: "controller", address: "0x" + "c".repeat(40), integrations }] }) as unknown as Pick<StoredPauSnapshot, "chain" | "contracts">;
const anchor = { id: "ethereum-diamond", aliases: [] };

afterEach(cleanup);

describe("PauFacets", () => {
  it("lists the facets alphabetically with their Atlas ceilings", async () => {
    render(<PauFacets snap={snap(integration("USDS_FACET", "0x" + "1".repeat(40)), integration("CCTP_FACET", "0x" + "2".repeat(40)), integration("ERC4626_FACET", "0x" + "3".repeat(40)))} anchor={anchor} />);
    const ceiling = await screen.findByRole("link", { name: "Mint 50,000,000 USDS" });
    expect(ceiling).toHaveAttribute("href", "/atlas?id=usds");
    const rows = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(rows).toEqual(["CCTP Facet", "ERC4626 Facet", "USDS Facet"]);
    expect(screen.getByRole("link", { name: "not yet stated" })).toHaveAttribute("href", "/atlas?id=cctp");
  });
  it("renders nothing for a deployment with no integrations", () => {
    const { container } = render(<PauFacets snap={snap()} anchor={anchor} />);
    expect(container).toBeEmptyDOMElement();
  });
});
