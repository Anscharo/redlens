// @vitest-environment jsdom
// An instance card's on-chain marks and document links: each maxAmount and
// slope row gets its check's mark in one column, every other row keeps that
// column empty, and each row links to the document that states it.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ValueCheck, ValueStatus } from "@/lib/pauAtlasValues";
import type { RadarInstance } from "../../lib/actorIndex";
import { indexParamChecks } from "../../lib/paramChecks";
import { InstanceCard } from "./InstanceCard";

afterEach(cleanup);

const inst: RadarInstance = {
  id: "i", slug: "i", rawName: "SparkLend USDS", st: "asi", displayName: "Ethereum Mainnet - SparkLend USDS", status: "Active",
  docId: "inst-doc", docNo: null, primitiveTitle: null, primitiveDocId: null, primitiveCategory: null, primitiveCategoryDocId: null,
  isUnknownPrimitive: false,
  signalParams: [
    { key: "Network", value: "Ethereum Mainnet", srcDocId: "inst-doc" },
    { key: "Inflow Rate Limit / maxAmount", value: "200,000,000 USDS", srcDocId: "inflow-doc" },
    { key: "Outflow Rate Limit / maxAmount", value: "Unlimited", srcDocId: "outflow-doc" },
  ],
};

const check = (docId: string, label: string, stated: string, status: ValueStatus): ValueCheck => ({
  docId, instance: inst.rawName, instanceDocId: "inst-doc", label, field: "maxAmount", stated, status,
  key: "0xk", chain: "ethereum", kind: "monolithic", contract: "0xrl", limit: null, readAt: null,
});

const checks = indexParamChecks([
  check("inflow-doc", "Inflow maxAmount", "200,000,000 USDS", "mismatch"),
  check("outflow-doc", "Outflow maxAmount", "Unlimited", "no-key"),
]);

const marks = (container: HTMLElement) => [...container.querySelectorAll("[data-check], span.w-4")].map((e) => e.getAttribute("data-check"));

describe("InstanceCard on-chain marks", () => {
  it("marks each checked value, linked to its document's Onchain tab, and leaves the other rows' column empty", () => {
    const { container } = render(<InstanceCard inst={inst} checks={checks} />);
    expect(marks(container)).toEqual([null, "mismatch", "unsure"]);
    expect(screen.getByRole("link", { name: "Differs from the atlas" })).toHaveAttribute("href", expect.stringContaining("inflow-doc"));
    expect(screen.getByRole("link", { name: "Differs from the atlas" })).toHaveAttribute("href", expect.stringContaining("view=onchain"));
    expect(screen.getByRole("link", { name: "Can't be compared" })).toBeInTheDocument();
  });

  it("keeps no mark column on a card with nothing checked", () => {
    const { container } = render(<InstanceCard inst={inst} />);
    expect(marks(container)).toEqual([]);
  });

  it("links every row to the document that states it", () => {
    render(<InstanceCard inst={inst} />);
    expect(screen.getByRole("link", { name: "Open the document stating Inflow Rate Limit / maxAmount" })).toHaveAttribute("href", expect.stringContaining("inflow-doc"));
    expect(screen.getByRole("link", { name: "Open the document stating Network" })).toHaveAttribute("href", expect.stringContaining("inst-doc"));
  });
});
