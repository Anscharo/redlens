// @vitest-environment jsdom
// The graph half of the address hover card: a multisig's threshold and
// signers, and the atlas documents naming the address outside the reader.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { AddressTooltip } from "./AddressTooltip";
import { resetSharedBalances } from "../lib/sharedBalances";

const EVM = "0x148ef923d764cbdc1597ccadbbbc66499c1a1432";

vi.mock("@/lib/balances", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBalancesCached: () => Promise.resolve({ lastCheckedAt: null, nextRefreshAt: null, refreshed: false, addresses: {} }),
  peekCachedBalances: () => null,
}));

const location = vi.hoisted(() => ({ path: "/radar" }));
vi.mock("wouter", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useLocation: () => [location.path, () => {}],
}));

const GRAPH = {
  participants: [
    { id: "ms", slug: "ms", name: "Core Council Multisig", et: "multisig", st: null, did: "root-doc",
      m: JSON.stringify({ address: EVM, chain: "ethereum", threshold: "5/6" }) },
    { id: "soter", slug: "soter", name: "Soter Labs", et: "govops_org", st: null, did: null },
    { id: "jan", slug: "jan", name: "JanSky", et: "delegate_org", st: null, did: null },
  ],
  instances: [], invocations: [], primitives: [],
  edges: [
    { f: "soter", ft: "entity", t: "ms", tt: "entity", e: "signer_of", m: JSON.stringify({ signer_count: 4 }) },
    { f: "jan", ft: "entity", t: "ms", tt: "entity", e: "signer_of", m: JSON.stringify({ signer_count: 2 }) },
    ...["A.1.1", "A.1.2", "A.1.3", "A.1.4"].map((docNo, i) => (
      { f: `doc-${i}`, ft: "doc", t: `${EVM}:ethereum`, tt: "address", e: "mentions", s: [docNo] }
    )),
  ],
};
vi.mock("../lib/graph", () => ({ loadGraph: () => Promise.resolve(GRAPH) }));

beforeEach(() => {
  vi.useFakeTimers();
  location.path = "/radar";
  resetSharedBalances();
});
afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

async function hover() {
  render(
    <AddressTooltip address={EVM}>
      <a href="#">trigger</a>
    </AddressTooltip>,
  );
  fireEvent.mouseEnter(screen.getByText("trigger"));
  await act(async () => {
    vi.advanceTimersByTime(800);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return screen.getByRole("tooltip");
}

describe("AddressTooltip graph facts", () => {
  it("shows a multisig's threshold as M / N and lists its signers with counts", async () => {
    const tip = await hover();
    expect(tip).toHaveTextContent("threshold 5 / 6");
    expect(within(tip).getByRole("link", { name: "Core Council Multisig" })).toHaveAttribute("href", expect.stringContaining("id=root-doc"));
    const signers = within(tip).getAllByRole("listitem").map((li) => li.textContent);
    expect(signers).toEqual(["Soter Labs4", "JanSky2"]);
  });

  it("links back to the first mentioning docs outside the reader", async () => {
    const tip = await hover();
    expect(within(tip).getByRole("link", { name: "A.1.1" })).toHaveAttribute("href", expect.stringContaining("id=doc-0"));
    expect(within(tip).getByRole("link", { name: "A.1.3" })).toBeInTheDocument();
    expect(within(tip).queryByRole("link", { name: "A.1.4" })).toBeNull();
    expect(tip).toHaveTextContent("+1 more");
  });

  it("leaves the doc links out in the atlas reader", async () => {
    location.path = "/atlas";
    const tip = await hover();
    expect(tip).toHaveTextContent("threshold 5 / 6");
    expect(within(tip).queryByRole("link", { name: "A.1.1" })).toBeNull();
  });
});
