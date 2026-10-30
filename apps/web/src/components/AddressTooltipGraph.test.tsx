// @vitest-environment jsdom
// The Safe and atlas half of the address hover card: the live owners and
// threshold, the atlas's threshold only when it disagrees, and the atlas
// documents naming the address outside the reader.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { AddressTooltip } from "./AddressTooltip";
import { resetSharedBalances } from "../lib/sharedBalances";
import { setAddressMap } from "../lib/addressMap";
import { makeAddressInfo } from "../test/fixtures";

const EVM = "0x148ef923d764cbdc1597ccadbbbc66499c1a1432";

const OWNERS = ["0xaaaa000000000000000000000000000000000001", "0xbbbb000000000000000000000000000000000002"];
const chain = vi.hoisted(() => ({ safe: null as { threshold: number; owners: string[] } | null }));
vi.mock("@/lib/balances", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBalancesCached: () => Promise.resolve({
    lastCheckedAt: null, nextRefreshAt: null, refreshed: false,
    addresses: { [`${EVM}|ethereum`]: { chain: "ethereum", checkedAt: null, balances: {}, hasCode: null, safe: chain.safe } },
  }),
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
  chain.safe = { threshold: 5, owners: [...OWNERS, ...["3", "4", "5", "6"].map((n) => `0x${n.repeat(40)}`)] };
  setAddressMap({ [EVM]: makeAddressInfo({ chainlogId: "Core Council Multisig" }) });
  resetSharedBalances();
});
afterEach(() => {
  cleanup();
  setAddressMap({});
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
  it("shows the on-chain threshold and owner addresses, not the atlas's signer parties", async () => {
    const tip = await hover();
    expect(tip).toHaveTextContent("threshold 5 / 6");
    const owners = within(tip).getByRole("list", { name: "Owners" });
    expect(within(owners).getAllByRole("link")[0]).toHaveAttribute("title", OWNERS[0]);
    expect(tip).not.toHaveTextContent("Soter Labs");
    expect(tip).not.toHaveTextContent("Atlas states");
  });

  it("adds the atlas's threshold, linked to its document, when the chain disagrees", async () => {
    chain.safe = { threshold: 2, owners: OWNERS };
    const tip = await hover();
    expect(tip).toHaveTextContent("threshold 2 / 2");
    expect(tip).toHaveTextContent("Atlas states 5 / 6");
    expect(within(tip).getByRole("link", { name: "Core Council Multisig" })).toHaveAttribute("href", expect.stringContaining("id=root-doc"));
  });

  it("shows no Safe block without an on-chain read", async () => {
    chain.safe = null;
    const tip = await hover();
    expect(tip).not.toHaveTextContent("threshold");
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
    expect(within(tip).queryByRole("link", { name: "A.1.1" })).toBeNull();
  });
});
