// @vitest-environment jsdom
// The Radar PAUs subpage body: a prime's stored snapshots only (or a note that
// there are none), rate limits named by the prime or instance that states their
// ID (an unnamed key says so),
// role holders marked as the chain confirms them, and a deployment whose
// history is still being read says that instead of looking complete.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PauHistoryResponse, PauResponse, StoredPauSnapshot } from "../../lib/pau";

const PRIME = "dee2f5a4-0000-4000-8000-000000000000";
const RL = "0x" + "1".repeat(40);
const CTRL = "0x" + "c".repeat(40);
const NAMED = "0x" + "ab".repeat(32);
const UNNAMED = "0x" + "cd".repeat(32);
const OFF = "0x" + "ef".repeat(32);
const MINT = "0x" + "12".repeat(32);
const DERIVED = "0x" + "34".repeat(32);
const VAULT = "0x" + "7".repeat(40);
const LISTED = "0x" + "8".repeat(40);
const BY_ADDRESS = "0x" + "56".repeat(32);
const BEAM = "0x" + "6".repeat(40);
const at = { block: 1, time: "2026-09-01T00:00:00.000Z", tx: "0x" + "9".repeat(64) };
const limit = (key: string, maxAmount: string, slope: string, available: string | null) => ({
  key, configured: { maxAmount, slope }, setAt: at, changes: 1,
  data: { maxAmount, slope, lastAmount: maxAmount, lastUpdated: "1" }, available,
});
const holder = (account: string, holds: boolean | null) => ({ role: "0xr", name: "RELAYER", account, since: at, holds });

const ETH: StoredPauSnapshot = {
  deployment: `${PRIME}:ethereum:monolithic`, prime: PRIME, primeName: "Spark", chain: "ethereum", kind: "monolithic", fetchedAt: "2026-10-07T16:00:00.000Z",
  contracts: [
    { role: "controller", address: CTRL, atlasDocs: ["doc-ctrl"], events: 3, historyComplete: true, roles: [holder("0x" + "a".repeat(40), true), holder("0x" + "b".repeat(40), false), holder("0x" + "d".repeat(40), null)],
      params: [{ event: "MaxSlippageSet", subject: "0x" + "5".repeat(40), args: { pool: "0x" + "5".repeat(40), maxSlippage: "999" }, setAt: at }] },
    { role: "rateLimits", address: RL, atlasDocs: ["doc-rl", "doc-rl-2"], events: 3, historyComplete: true, rateLimits: [limit(OFF, "0", "0", "0"), limit(MINT, "50000000000000000000000000", "0", null), { ...limit(DERIVED, "5000000000000", "0", null), derived: { constant: "LIMIT_4626_DEPOSIT", args: [VAULT] } }, { ...limit(BY_ADDRESS, "7000000000000", "0", null), derived: { constant: "LIMIT_ASSET_TRANSFER", args: [VAULT, LISTED] }, unit: { decimals: 6, symbol: "PYUSD", token: VAULT, source: "token" as const } }, limit(UNNAMED, "1000000000000000000000000000", "0", null), limit(NAMED, "25000000000000", "289351851", "12000000000000")],
      beam: { beamState: BEAM, hop: "57600", maxChange: "1200000000000000000", historyComplete: true, defaults: [{ key: MINT, maxAmount: "10000000000000000000000000", slope: "0", scope: "general" as const, setAt: null }] } },
    { role: "administeredAgent", address: "0x" + "e".repeat(40), events: 2, historyComplete: false,
      agent: { actors: [{ account: "0x" + "e1".repeat(20), since: at, holds: true }, { account: "0x" + "e2".repeat(20), since: null, holds: true }], revokers: [{ account: "0x" + "e3".repeat(20), since: at }] } },
  ],
};
const BASE: StoredPauSnapshot = { ...ETH, deployment: `${PRIME}:base:monolithic`, chain: "base", contracts: [{ role: "rateLimits", address: RL, events: 0, historyComplete: false }] };
let served: PauResponse = { deployments: [BASE, ETH, { ...ETH, prime: "other", deployment: "other:ethereum:monolithic" }] };

const SPELL = "0x" + "5e".repeat(20);
const change = { deployments: [ETH.deployment], contract: RL, role: "rateLimits", event: "RateLimitDataSet", args: { maxAmount: "25000000000000", slope: "0" }, subject: NAMED, label: null, before: { maxAmount: "10000000000000", slope: "0" } };
const spellOrigin = { kind: "spell" as const, path: "starguard" as const, spell: SPELL, starSpell: null, l1Tx: at.tx, from: null, to: null, relay: null, evidence: "StarGuard Exec" };
const history: PauHistoryResponse = {
  entries: [
    { chain: "ethereum", tx: "0x" + "1".repeat(64), block: 1, time: "2025-01-01T00:00:00.000Z", primes: [PRIME], origin: { ...spellOrigin, kind: "deployment", path: null, spell: null, from: "0x" + "d".repeat(40) }, executive: null, changes: [change] },
    { chain: "ethereum", tx: at.tx, block: 2, time: at.time, primes: [PRIME], origin: spellOrigin, executive: { title: "Prime Agent Proxy Spells", date: "2026-08-27", url: "https://vote.example/x", source: "vote-record" }, changes: [change] },
  ],
};

vi.mock("../../lib/pau", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/pau")>();
  return { ...actual, loadPau: () => Promise.resolve(served), loadPauHistory: () => Promise.resolve(history) };
});

vi.mock("../../lib/graph", () => ({ loadGraph: () => Promise.resolve({ participants: [{ id: PRIME, slug: "spark", name: "Spark", et: "agent", st: "prime", did: "p", m: "{}" }], instances: [], invocations: [], primitives: [], edges: [] }) }));
vi.mock("@/lib/pauAtlasValues", () => ({
  checkAtlasValues: () => [
    { contract: RL, key: NAMED, status: "match" }, { contract: RL, key: NAMED, status: "match" },
    { contract: RL, key: MINT, status: "match" }, { contract: RL, key: MINT, status: "mismatch" },
  ],
}));

import { ActorPau } from "./ActorPau";
import { ParamAddressKeys } from "./ParamAddressKeys";

const instances = [
  { displayName: "SparkLend USDC", signalParams: [{ key: "Inflow Rate Limit ID", value: NAMED, srcDocId: "doc-1" }] },
  { displayName: "Blackrock USDC", signalParams: [{ key: "Rate Limit IDs / BUIDLI_DEPOSIT", value: LISTED, srcDocId: "doc-3" }] },
];
const prime = { id: PRIME, m: JSON.stringify({ params: { "USDS Mint RateLimitID": [MINT, "doc-2", "A.1"] } }) };

afterEach(cleanup);

describe("ActorPau change history", () => {
  it("groups changes under their executive, collapses the deployment, and chips each Set date with its origin", async () => {
    render(<ActorPau prime={prime} instances={instances} />);
    const section = await screen.findByRole("region", { name: "Change history" });
    const groups = section.querySelectorAll(".pau-timeline-group");
    expect([...groups].map((g) => g.getAttribute("data-kind"))).toEqual(["executive", "deployment"]);
    expect(within(groups[0] as HTMLElement).getByRole("link", { name: "Executive Vote 2026-08-27" })).toHaveAttribute("href", "https://vote.example/x");
    expect(groups[0]).toHaveTextContent("through the StarGuard");
    expect(groups[0]).toHaveTextContent("max 25M (was 10M)");
    expect(groups[1].querySelector("details")).not.toHaveAttribute("open");
    const chips = await screen.findAllByText("exec 2026-08-27");
    expect(chips[0]).toHaveAttribute("href", `#pau-tx-ethereum-${at.tx}`);
  });
});

describe("ActorPau change history key and unattributed changes", () => {
  it("explains the group kinds the history holds", async () => {
    render(<ActorPau prime={prime} instances={instances} />);
    const key = await screen.findByText("Executive Vote", { selector: "dt" });
    const dl = key.closest("dl") as HTMLElement;
    expect([...dl.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Executive Vote", "Deployment"]);
  });

  it("folds unattributed changes by chain, says why each is pending, and notes when nothing is attributed yet", async () => {
    const saved = history.entries;
    history.entries = saved.map((e, i) => ({ ...e, tx: "0x" + String(i + 1).repeat(64), origin: i === 0 ? null : { ...e.origin!, kind: "unknown" as const, spell: null, evidence: "the DSPause casts are not read to block 5 yet" }, executive: null }));
    try {
      render(<ActorPau prime={prime} instances={instances} />);
      const section = await screen.findByRole("region", { name: "Change history" });
      await waitFor(() => expect(section.querySelector("[data-unattributed]")).toHaveTextContent("None of this Prime's 2 changes is attributed yet"));
      expect(section.querySelector("dl")).toBeNull();
      const groups = section.querySelectorAll(".pau-timeline-group");
      expect([...groups].map((g) => g.getAttribute("data-kind"))).toEqual(["unknown"]);
      expect(within(groups[0] as HTMLElement).getByRole("heading", { level: 3, name: "Not yet attributed" })).toBeInTheDocument();
      expect(groups[0].querySelector("details")).not.toHaveAttribute("open");
      expect(groups[0]).toHaveTextContent("not yet attributed: the DSPause casts are not read to block 5 yet");
      expect(groups[0]).toHaveTextContent("not yet attributed: the worker has not checked this transaction yet");
    } finally {
      history.entries = saved;
    }
  });
});

describe("ActorPau", () => {
  it("lists the prime's deployments only, Ethereum first and open", async () => {
    render(<ActorPau prime={prime} instances={instances} />);
    await waitFor(() => expect(screen.getByRole("region", { name: "Current state" })).toBeInTheDocument());
    const cards = document.querySelectorAll("details.pau-deployment");
    expect([...cards].map((c) => c.getAttribute("data-deployment"))).toEqual([ETH.deployment, BASE.deployment]);
    expect(cards[0]).toHaveAttribute("open");
    expect(cards[1]).not.toHaveAttribute("open");
    expect(within(cards[1] as HTMLElement).getByText("history still being read")).toBeInTheDocument();
  });

  it("names a rate limit by its instance or the prime, else by its derivation, flags an unnamed key, and sorts switched-off keys last", async () => {
    render(<ActorPau prime={prime} instances={instances} />);
    const [table] = await screen.findAllByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByRole("link", { name: "Blackrock USDC · BUIDLI_DEPOSIT (matched by address)" })).toHaveAttribute("title", expect.stringContaining(`the atlas lists ${LISTED} here`));
    expect(rows[0]).toHaveTextContent("7M PYUSD");
    expect(within(rows[0]).getAllByTitle(`6 decimals, read from PYUSD ${VAULT}`)).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("SparkLend USDC · Inflow");
    expect(rows[1]).toHaveTextContent(/25M.*25M.*12M/);
    expect(within(rows[1]).getByRole("link", { name: "SparkLend USDC · Inflow" })).toBeInTheDocument();
    expect(within(rows[2]).getByRole("link", { name: "USDS Mint" })).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent("LIMIT_4626_DEPOSIT");
    expect(rows[3].querySelector("[title*='no atlas document states this key']")).not.toBeNull();
    expect(rows[4]).toHaveTextContent("no document or controller constant found referencing this limit");
    expect(rows[4]).toHaveTextContent(/1B.*0.*\?/);
    expect(rows[5]).toHaveAttribute("data-off", "true");
    expect(rows[5]).toHaveTextContent("off");
  });

  it("heads the page's two parts at h2, each chain and history group at h3, and a chain's parts at h4", async () => {
    render(<ActorPau prime={prime} instances={instances} />);
    await screen.findByRole("region", { name: "Change history" });
    expect(screen.getAllByRole("heading", { level: 2 })).toEqual([
      screen.getByRole("heading", { level: 2, name: "Current state" }),
      screen.getByRole("heading", { level: 2, name: "Change history" }),
    ]);
    const h3 = screen.getAllByRole("heading", { level: 3 });
    expect(h3.slice(0, 2)).toEqual([screen.getByRole("heading", { level: 3, name: "Ethereum" }), screen.getByRole("heading", { level: 3, name: "Base" })]);
    expect(screen.getByRole("heading", { level: 3, name: "Deployment" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /Executive Vote 2026-08-27/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Roles" })).toBeInTheDocument();
  });

  it("keeps the summary free of links and links each cited contract to its own atlas document", async () => {
    render(<ActorPau prime={prime} instances={instances} />);
    await screen.findByRole("region", { name: "Current state" });
    const card = document.querySelector(`details[data-deployment="${ETH.deployment}"]`) as HTMLElement;
    expect(card.querySelector("summary a")).toBeNull();
    expect(within(card).getByRole("link", { name: "Controller" })).toHaveAttribute("href", expect.stringContaining("doc-ctrl"));
    const rl = within(card).getByRole("link", { name: "Rate limits" });
    expect(rl).toHaveAttribute("href", expect.stringContaining("doc-rl"));
    expect(rl).toHaveAttribute("title", expect.stringContaining("2 atlas documents"));
    expect(within(card).queryByRole("link", { name: "AdministeredAgent" })).toBeNull();
    const base = document.querySelector(`details[data-deployment="${BASE.deployment}"]`) as HTMLElement;
    expect(within(base).queryByRole("link", { name: "monolithic" })).toBeNull();
  });

  it("titles the table Rate limits and checks only keys whose every atlas value matches the chain", async () => {
    render(<ActorPau prime={prime} instances={instances} />);
    const [table] = await screen.findAllByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Rate limits" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Matches Atlas" })).toBeInTheDocument();
    await waitFor(() => expect(table.querySelectorAll("[data-atlas-match]")).toHaveLength(1));
    const row = table.querySelector("[data-atlas-match]")!.closest("tr") as HTMLElement;
    expect(within(row).getByRole("link", { name: "SparkLend USDC · Inflow" })).toBeInTheDocument();
    expect(within(row).getByRole("img", { name: "matches the atlas" })).toHaveTextContent("✓");
  });

  it("says what the Configurator may do without a spell, and lists the default limits by name", async () => {
    render(<ActorPau prime={prime} instances={instances} />);
    const beam = await screen.findByText("Configurator limits");
    const block = beam.closest(".pau-beam") as HTMLElement;
    expect(block).toHaveTextContent("by up to 1.2×, once every 16 h per key");
    const rows = within(within(block).getByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByRole("link", { name: "USDS Mint" })).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent(/10M.*0.*all/);
  });

  it("marks each role holder and AdministeredAgent member as the chain confirms it, and lists the parameters", async () => {
    render(<ActorPau prime={prime} instances={instances} />);
    await screen.findByText("Roles");
    const statuses = [...document.querySelectorAll("li[data-status]")].map((li) => li.getAttribute("data-status"));
    expect(statuses).toEqual(["holds", "holds", "holds", "denied", "unread", "unread"]);
    expect(screen.getByRole("img", { name: /chain says it does not hold the role/ })).toHaveTextContent("✗");
    expect(screen.getAllByLabelText("the AdministeredAgent lists it")).toHaveLength(2);
    expect(screen.getByLabelText("membership could not be read")).toBeInTheDocument();
    expect(screen.getByText("not in the stored history")).toBeInTheDocument();
    expect(screen.getByText("MaxSlippageSet")).toBeInTheDocument();
  });

  it("shows under an instance's address-valued RateLimitID the on-chain key derived from it, linked to the PAUs page", async () => {
    render(<ParamAddressKeys prime={{ id: PRIME, slug: "spark" }} paramKey="Rate Limit IDs / BUIDLI_DEPOSIT" value={LISTED} />);
    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent(`on-chain key ${BY_ADDRESS.slice(0, 10)}…${BY_ADDRESS.slice(-4)} · LIMIT_ASSET_TRANSFER · ethereum · 7M PYUSD`);
    expect(within(item).getByRole("link")).toHaveAttribute("href", "/radar/spark/pau");
  });

  it("says so for a prime with no snapshot", async () => {
    served = { deployments: [] };
    render(<ActorPau prime={prime} instances={instances} />);
    expect(await screen.findByText("no PAU contracts have been read for this Prime yet")).toBeInTheDocument();
    expect(document.querySelector("details.pau-deployment")).toBeNull();
  });
});

describe("ActorPau fragments", () => {
  const arrive = async (hash: string) => {
    window.location.hash = hash;
    render(<ActorPau prime={prime} instances={instances} />);
    await screen.findByRole("region", { name: "Change history" });
    return waitFor(() => {
      const el = document.querySelector("[data-arrived]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
  };
  beforeEach(() => {
    served = { deployments: [BASE, ETH] };
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    window.location.hash = "";
  });

  it("names every chain, section and history group, each with a # that holds its link", async () => {
    render(<ActorPau prime={prime} instances={instances} />);
    await screen.findByRole("region", { name: "Change history" });
    for (const id of ["current-state", "ethereum", "base", "ethereum-roles", "ethereum-rate-limits", "change-history", "exec-vote-2026-08-27", "deployment-ethereum"]) {
      expect(document.getElementById(id), id).not.toBeNull();
      expect(document.querySelector(`button.copy-link[data-link="#${id}"]`), id).not.toBeNull();
    }
    expect(screen.getByRole("heading", { level: 4, name: "Roles" })).toBeInTheDocument();
  });

  it("copies a section's full link from its # without moving the page or its URL, and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ActorPau prime={prime} instances={instances} />);
    const before = window.location.href;
    const button = await screen.findByRole("button", { name: "Copy link to Executive Vote 2026-08-27" });
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}#exec-vote-2026-08-27`);
    expect(await screen.findByRole("button", { name: "Link to Executive Vote 2026-08-27 copied" })).toHaveTextContent("✓");
    expect(window.location.href).toBe(before);
  });

  it("lands on a bare section name, in any case, at the first chain showing it", async () => {
    expect((await arrive("#Rate-limits")).id).toBe("ethereum-rate-limits");
  });

  it("opens a collapsed deployment or history group it lands on", async () => {
    const card = await arrive("#base");
    expect(card).toHaveAttribute("open");
    cleanup();
    const group = await arrive("#deployment-ethereum");
    expect(group.tagName).toBe("DETAILS");
    expect(group).toHaveAttribute("open");
  });

  it("lands on an executive's group by its spell address", async () => {
    const el = await arrive(`#spell-${spellOrigin.spell.toLowerCase()}`);
    expect(el.id).toBe("exec-vote-2026-08-27");
  });
});
