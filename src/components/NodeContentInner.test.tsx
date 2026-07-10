// @vitest-environment jsdom
// Component tests for NodeContentInner — the markdown renderer.
// Verifies the reader-facing rendering pipeline: address linkification,
// UUID navigation links, and basic markdown output.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import NodeContentInner from "./NodeContentInner";
import { setAddressMap } from "../lib/addressMap";

const EVM = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";
const UUID = "1ce24b08-84ff-4524-9710-49bba429c6ef";
const DOC_NO = "A.3.7.1.2.2";

// resolveAtlasRef is fed by loaded atlas bundles at runtime; stub it so the
// renderer sees UUID/doc_no -> internal-id only for nodes we "host".
vi.mock("../lib/docs", () => ({
  resolveAtlasRef: (fragment: string) =>
    fragment === UUID || fragment === DOC_NO ? UUID : undefined,
}));

beforeEach(() => setAddressMap({}));
afterEach(cleanup);

describe("EVM address rendering", () => {
  it("renders an EVM address as a link to etherscan", async () => {
    render(<NodeContentInner content={`See ${EVM} for details.`} />);
    const link = await screen.findByRole("link", { name: EVM });
    expect(link).toHaveAttribute("href", `https://etherscan.io/address/${EVM}`);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("uses explorerUrl from the address map when set", async () => {
    setAddressMap({ [EVM.toLowerCase()]: { explorerUrl: "https://custom.io/addr" } });
    render(<NodeContentInner content={EVM} />);
    const link = await screen.findByRole("link", { name: EVM });
    expect(link).toHaveAttribute("href", "https://custom.io/addr");
  });
});

describe("UUID link rendering", () => {
  it("renders a UUID markdown link with SPA href and calls onNavigate", async () => {
    const onNavigate = vi.fn();
    render(
      <NodeContentInner
        content={`[Go to node](${UUID})`}
        onNavigate={onNavigate}
      />,
    );
    const link = await screen.findByRole("link", { name: "Go to node" });
    expect(link).toHaveAttribute("href", `/atlas?id=${UUID}`);
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith(UUID);
  });

  it("renders a UUID link as external when no onNavigate is provided", async () => {
    render(<NodeContentInner content={`[Go to node](${UUID})`} />);
    const link = await screen.findByRole("link", { name: "Go to node" });
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("sky-atlas.io deep-link internalisation", () => {
  it("internalises a sky-atlas.io UUID deep-link to an SPA navigation", async () => {
    const onNavigate = vi.fn();
    render(
      <NodeContentInner
        content={`[See section](https://sky-atlas.io/#${UUID})`}
        onNavigate={onNavigate}
      />,
    );
    const link = await screen.findByRole("link", { name: "See section" });
    expect(link).toHaveAttribute("href", `/atlas?id=${UUID}`);
    expect(link).not.toHaveAttribute("target", "_blank");
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith(UUID);
  });

  it("internalises a sky-atlas.io doc_no deep-link by resolving to the node id", async () => {
    const onNavigate = vi.fn();
    render(
      <NodeContentInner
        content={`[Update Process](https://sky-atlas.io/#${DOC_NO})`}
        onNavigate={onNavigate}
      />,
    );
    const link = await screen.findByRole("link", { name: "Update Process" });
    expect(link).toHaveAttribute("href", `/atlas?id=${UUID}`);
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith(UUID);
  });

  it("decodes a percent-encoded fragment before resolving it", async () => {
    const onNavigate = vi.fn();
    // "A%2E3%2E7%2E1%2E2%2E2" decodes to DOC_NO ("A.3.7.1.2.2"), which the mock
    // resolver hosts — exercises the decodeURIComponent branch in internalTargetId.
    const href = "https://sky-atlas.io/#A%2E3%2E7%2E1%2E2%2E2";
    render(<NodeContentInner content={`[Update Process](${href})`} onNavigate={onNavigate} />);
    const link = await screen.findByRole("link", { name: "Update Process" });
    expect(link).toHaveAttribute("href", `/atlas?id=${UUID}`);
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith(UUID);
  });

  it("keeps a sky-atlas.io link external when the node isn't hosted internally", async () => {
    const onNavigate = vi.fn();
    const href = "https://sky-atlas.io/#Z.9.9.9";
    render(<NodeContentInner content={`[Elsewhere](${href})`} onNavigate={onNavigate} />);
    const link = await screen.findByRole("link", { name: "Elsewhere" });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("KaTeX lazy-load retry after a failed chunk import", () => {
  // katexPromise is a module-level cache: a rejected dynamic import (e.g. a
  // stale chunk URL right after a redeploy) must not be cached forever, or
  // every subsequent math node in the session would await the same dead
  // promise and never render KaTeX again. Fails the FIRST dynamic import of
  // rehype-katex, succeeds on the second — a fresh module instance per test
  // (vi.resetModules) isolates the module-level katexPromise/rehypePluginsMath.
  let attempt = 0;

  beforeEach(() => {
    attempt = 0;
    vi.resetModules();
    vi.doMock("rehype-katex", () => {
      attempt++;
      if (attempt === 1) throw new Error("simulated chunk load failure");
      return { default: () => {} };
    });
    vi.doMock("remark-math", () => ({ default: () => {} }));
    vi.doMock("katex/dist/katex.min.css", () => ({}));
  });

  it("retries the import (and eventually renders math) after an earlier failure", async () => {
    const { default: FreshNodeContentInner } = await import("./NodeContentInner");
    render(<FreshNodeContentInner content="Inline math $x^2$ here." />);
    // First mount: the import throws, so it falls back to plain markdown —
    // the raw, un-rendered math delimiters stay in the text.
    expect(await screen.findByText(/\$x\^2\$/)).toBeInTheDocument();
    cleanup();

    // Second node (or a retry of the same one): the cached promise must have
    // been cleared, so this import attempt is fresh — and it succeeds this
    // time, proving the failure wasn't cached forever.
    render(<FreshNodeContentInner content="Inline math $y^2$ here." />);
    await screen.findByText(/\$y\^2\$/);
    expect(attempt).toBe(2);
  });
});

describe("basic markdown", () => {
  it("renders plain text without crashing", async () => {
    render(<NodeContentInner content="Hello world." />);
    expect(await screen.findByText("Hello world.")).toBeInTheDocument();
  });

  it("renders a markdown table", async () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |";
    render(<NodeContentInner content={md} />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("renders bold text", async () => {
    render(<NodeContentInner content="**important**" />);
    const strong = await screen.findByText("important");
    expect(strong.tagName).toBe("STRONG");
  });
});
