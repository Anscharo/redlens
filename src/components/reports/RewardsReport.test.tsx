// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

Element.prototype.scrollIntoView = vi.fn();
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import type { RewardsIndex } from "../../lib/rewardsIndex";

const fixture: RewardsIndex = {
  agents: [
    {
      name: "Spark",
      docNoPrefix: "A.6.1.1.1.",
      agentEntity: { id: "agent-1", name: "Spark", slug: "spark" },
      chain: {
        executor: { id: "exec-1", name: "Spark Executor", slug: "spark-exec" },
        govops: { id: "gov-1", name: "Spark GovOps", slug: "spark-govops" },
      },
      dr: {
        kind: "DR",
        primitiveId: "dr-prim",
        primitiveDocNo: "A.2.2.1.1",
        globalActivation: "Active",
        active: [
          {
            id: "inst-1",
            docNo: "A.6.1.1.1.3.4.1",
            name: "Spark DR Instance",
            status: "Active",
            rewardCode: "SPK-DR-1",
            rewardAddress: undefined,
          },
        ],
        suspended: [],
        completed: [],
        invocations: [],
      },
      ib: {
        kind: "IB",
        primitiveId: "ib-prim",
        primitiveDocNo: "A.2.2.1.3",
        globalActivation: "Active",
        active: [
          {
            id: "inst-2",
            docNo: "A.6.1.1.1.4.4.1",
            name: "Spark IB Instance",
            status: "Active",
            partnerName: "Acme Partner",
            rewardAddress: "0x3333333333333333333333333333333333333333",
            rewardChain: "ethereum",
          },
        ],
        suspended: [],
        completed: [],
        invocations: [],
      },
    },
    {
      name: "Idle Agent",
      docNoPrefix: "A.6.1.1.2.",
      agentEntity: null,
      chain: null,
      dr: null,
      ib: null,
    },
  ],
  stUsdsDr: { id: "st-1", docNo: "A.2.2.1.2", title: "stUSDS DR", description: "stUSDS description" },
  srUsdsDr: null,
  drPrimitive: { id: "drp-1", docNo: "A.2.2.1.1", title: "Distribution Reward", description: "DR description" },
  ibPrimitive: null,
  demandSideBufferAddress: "0x2222222222222222222222222222222222222222",
};

let buildImpl = () => fixture;

vi.mock("../../lib/docs", () => ({ loadDocs: () => Promise.resolve({}) }));
vi.mock("../../lib/addresses", () => ({ loadAddresses: () => Promise.resolve({}) }));
vi.mock("../../lib/graph", () => ({ loadGraph: () => Promise.resolve({}) }));
vi.mock("../../lib/rewardsIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/rewardsIndex")>();
  return {
    ...actual,
    buildRewardsIndex: () => buildImpl(),
  };
});

import { RewardsReport } from "./RewardsReport";
import { ErrorBoundary } from "../ErrorBoundary";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  buildImpl = () => fixture;
  vi.restoreAllMocks();
});

describe("RewardsReport", () => {
  it("shows a loading state, then renders agent sections, ecosystem cards, and the summary line", async () => {
    render(<RewardsReport query="" mode="broad" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "Spark", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Idle Agent", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("(no instances)")).toBeInTheDocument();

    // Ecosystem header cards.
    expect(screen.getByText("stUSDS DR")).toBeInTheDocument();
    expect(screen.getAllByText("Distribution Reward").length).toBeGreaterThan(0);

    // Summary counts in the intro paragraph.
    expect(screen.getByText(/1 DR · 1 IB/)).toBeInTheDocument();
    expect(screen.getByText(/1 codes · 1 addresses/)).toBeInTheDocument();

    // Chain attribution line.
    expect(screen.getByText("Spark Executor")).toBeInTheDocument();
    expect(screen.getByText("Spark GovOps")).toBeInTheDocument();

    expect(screen.getByText("Download full report")).toBeInTheDocument();
  });

  it("filters agents by the query prop, hiding non-matching agents and showing NoRowsMatch when nothing matches", async () => {
    render(<RewardsReport query="spark" mode="broad" />);
    expect(await screen.findByRole("heading", { name: "Spark", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText("Idle Agent")).not.toBeInTheDocument();

    cleanup();
    render(<RewardsReport query="zzz-no-match" mode="broad" />);
    expect(await screen.findByText(/No rows match/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Spark" })).not.toBeInTheDocument();
  });

  it("shows the filtered download button once a query is active, and builds the filtered CSV on click", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<RewardsReport query="spark" mode="broad" />);
    await screen.findByRole("heading", { name: "Spark", level: 2 });
    fireEvent.click(screen.getByText("Download filtered report"));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("builds and downloads a CSV when the download button is clicked", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<RewardsReport query="" mode="broad" />);
    await screen.findByRole("heading", { name: "Spark", level: 2 });
    fireEvent.click(screen.getByText("Download full report"));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  // The page no longer carries its own error + retry UI: useLoaded re-throws a
  // load failure during render, so the route's ErrorBoundary (App wraps every
  // route, resetKey={location}) owns the error page for reports too.
  it("surfaces a load failure to the surrounding ErrorBoundary instead of a spinner", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const graphModule = await import("../../lib/graph");
    const spy = vi.spyOn(graphModule, "loadGraph").mockImplementationOnce(() =>
      Promise.reject(new Error("boom")),
    );

    render(
      <ErrorBoundary fallback={(error) => <p>page failed to load: {error.message}</p>}>
        <RewardsReport query="" mode="broad" />
      </ErrorBoundary>,
    );
    expect(await screen.findByText(/page failed to load: boom/)).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    spy.mockRestore();
  });
});
