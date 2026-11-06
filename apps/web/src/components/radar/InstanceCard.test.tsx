// @vitest-environment jsdom
// An instance card's on-chain marks and document links: each checked row
// (a maxAmount or slope, a RateLimitID, an address) gets its mark in one
// column, every other row keeps that column empty, and each row links to the
// document that states it.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ValueCheck, ValueStatus } from "@/lib/pauAtlasValues";
import { addressCheckId, type AddressCheck } from "@/lib/pauAddressChecks";
import type { RadarInstance } from "../../lib/actorIndex";
import { indexParamChecks } from "../../lib/paramChecks";
import type { CardMarks } from "../../lib/rowMark";
import { InstanceCard } from "./InstanceCard";

afterEach(cleanup);

const inst: RadarInstance = {
  id: "i", slug: "i", rawName: "SparkLend USDS", st: "asi", displayName: "Ethereum Mainnet - SparkLend USDS", status: "Active",
  docId: "inst-doc", docNo: null, primitiveTitle: null, primitiveDocId: null, primitiveCategory: null, primitiveCategoryDocId: null,
  isUnknownPrimitive: false,
  signalParams: [
    { key: "Rate Limit IDs", value: "To be specified", srcDocId: "inst-doc" },
    { key: "Network", value: "Ethereum Mainnet", srcDocId: "inst-doc" },
    { key: "Token Address", value: "0x" + "c".repeat(40), srcDocId: "inst-doc" },
    { key: "Underlying Asset Address", value: "0x" + "d".repeat(40), srcDocId: "inst-doc" },
    { key: "Inflow Rate Limit / maxAmount", value: "200,000,000 USDS", srcDocId: "inflow-doc" },
    { key: "Outflow Rate Limit / maxAmount", value: "Unlimited", srcDocId: "outflow-doc" },
  ],
};

const check = (docId: string, label: string, stated: string, status: ValueStatus): ValueCheck => ({
  docId, instance: inst.rawName, instanceDocId: "inst-doc", label, field: "maxAmount", stated, status,
  key: "0xk", chain: "ethereum", kind: "monolithic", contract: "0xrl", readAt: null,
  limit: status === "match" || status === "mismatch" ? {
    key: "0xk", configured: { maxAmount: "1", slope: "0" }, setAt: { block: 1, time: "2026-01-02T00:00:00Z", tx: "0xt" }, changes: 1,
    data: { maxAmount: "150000000000000000000000000", slope: "0", lastAmount: "0", lastUpdated: "0" }, available: null,
  } : null,
});

const address = (kind: AddressCheck["kind"], status: AddressCheck["status"], over: Partial<AddressCheck> = {}): AddressCheck => ({
  kind, status, subject: "0x", chain: "ethereum", limits: [], params: [], onchain: [], symbols: {}, ...over,
});

const marks: CardMarks = {
  values: indexParamChecks([
    check("inflow-doc", "Inflow maxAmount", "200,000,000 USDS", "mismatch"),
    check("outflow-doc", "Outflow maxAmount", "Unlimited", "no-key"),
  ]),
  addresses: new Map([
    [addressCheckId("inst-doc", "Rate Limit IDs"), address("rate-limit-id", "not-stated")],
    [addressCheckId("inst-doc", "Token Address"), address("address", "unsure", { reason: "no rate limit or controller parameter on-chain uses this address" })],
    [addressCheckId("inst-doc", "Underlying Asset Address"), address("underlying", "match", { onchain: ["0x" + "d".repeat(40)] })],
  ]),
  held: new Map(),
};

const shown = (container: HTMLElement) => [...container.querySelectorAll("span.w-4")].map((e) => e.getAttribute("data-check"));

describe("InstanceCard on-chain marks", () => {
  it("marks every checked row in one column, leaving the rest of the column empty", () => {
    const { container } = render(<InstanceCard inst={inst} marks={marks} />);
    expect(shown(container)).toEqual(["not-stated", null, "unsure", "match", "mismatch", "unsure"]);
  });

  it("links a mark to the Onchain tab of the document stating the row", () => {
    render(<InstanceCard inst={inst} marks={marks} />);
    const mismatch = screen.getByRole("link", { name: "Differs from the atlas" });
    expect(mismatch).toHaveAttribute("href", expect.stringContaining("inflow-doc"));
    expect(mismatch).toHaveAttribute("href", expect.stringContaining("view=onchain"));
    expect(screen.getByRole("link", { name: "Matches the chain" })).toHaveAttribute("href", expect.stringContaining("inst-doc"));
    expect(screen.getAllByRole("link", { name: "Can't be checked" })).toHaveLength(1);
  });

  it("flags a value the atlas leaves unstated while the chain holds its key switched on", () => {
    const tbs = { ...inst, signalParams: [{ key: "Outflow Rate Limit / maxAmount", value: "Will be specified in a future iteration", srcDocId: "outflow-doc" }] };
    const stated = check("outflow-doc", "Outflow maxAmount", tbs.signalParams[0].value, "not-stated");
    const on = { ...stated.limit, key: "0xk", configured: { maxAmount: "5000000", slope: "0" }, setAt: { block: 1, time: "2026-01-02T00:00:00Z", tx: "0xt" }, changes: 1, data: null, available: null };
    const withKey = (held: CardMarks["held"]): CardMarks => ({ values: indexParamChecks([stated]), addresses: new Map(), held });
    const { container, rerender } = render(<InstanceCard inst={tbs} marks={withKey(new Map([["ethereum|0xk", [on]]]))} />);
    expect(shown(container)).toEqual(["candidate"]);
    rerender(<InstanceCard inst={tbs} marks={withKey(new Map([["ethereum|0xk", [{ ...on, configured: { maxAmount: "0", slope: "0" } }]]]))} />);
    expect(shown(container)).toEqual(["not-stated"]);
  });

  it("keeps no mark column on a card with nothing checked", () => {
    const { container } = render(<InstanceCard inst={inst} />);
    expect(shown(container)).toEqual([]);
  });

  it("links every row to the document that states it", () => {
    render(<InstanceCard inst={inst} />);
    expect(screen.getByRole("link", { name: "Open the document stating Inflow Rate Limit / maxAmount" })).toHaveAttribute("href", expect.stringContaining("inflow-doc"));
    expect(screen.getByRole("link", { name: "Open the document stating Network" })).toHaveAttribute("href", expect.stringContaining("inst-doc"));
  });
});
