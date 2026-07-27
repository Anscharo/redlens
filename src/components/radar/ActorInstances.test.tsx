// @vitest-environment jsdom
// ActorInstances renders an agent's primitives grouped by category into two
// sibling sections — Invocations (in-progress) and Instances (operational) —
// with per-parameter value rendering that special-cases addresses, rate-limit
// hashes, placeholders, and markdown links. Fixtures are hand-written
// RadarPrimitive/RadarInstance shapes so no artifacts are loaded.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorInstances } from "./ActorInstances";
import type { RadarInstance, RadarPrimitive, InstanceParam } from "../../lib/actorIndex";

afterEach(cleanup);

function param(key: string, value: string, srcDocId: string | null = null): InstanceParam {
  return { key, value, srcDocId };
}

let idSeq = 0;
function inst(overrides: Partial<RadarInstance> = {}): RadarInstance {
  const id = `inst-${++idSeq}`;
  return {
    id,
    slug: id,
    rawName: "Instance",
    st: "dr",
    displayName: "An Instance",
    status: "Active",
    docId: "doc-1",
    docNo: "A.1",
    primitiveTitle: null,
    primitiveDocId: null,
    primitiveCategory: null,
    primitiveCategoryDocId: null,
    isUnknownPrimitive: false,
    signalParams: [],
    ...overrides,
  };
}

function prim(overrides: Partial<RadarPrimitive> = {}): RadarPrimitive {
  return {
    title: "Distribution Reward",
    docId: "prim-doc-1",
    st: "dr",
    category: "Genesis Primitives",
    categoryDocId: "cat-1",
    categoryOrder: 0,
    status: "Active",
    isUnknown: false,
    instances: [],
    invocations: [],
    ...overrides,
  };
}

describe("ActorInstances sections", () => {
  it("renders Instances and Invocations sections with counts", () => {
    const primitives = [
      prim({
        instances: [inst({ status: "Active" }), inst({ status: "Suspended" })],
        invocations: [inst({ status: "InProgress", displayName: "An Invocation" })],
      }),
    ];
    render(<ActorInstances primitives={primitives} />);
    expect(screen.getByRole("heading", { name: "Instances" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Invocations" })).toBeInTheDocument();
    // The category label appears once per section that has items.
    expect(screen.getAllByText("Genesis Primitives").length).toBeGreaterThan(0);
    expect(screen.getByText("An Invocation")).toBeInTheDocument();
  });

  it("omits the Invocations section when there are no invocations", () => {
    render(<ActorInstances primitives={[prim({ instances: [inst()] })]} />);
    expect(screen.queryByRole("heading", { name: "Invocations" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Instances" })).toBeInTheDocument();
  });

  it("shows an 'unknown' badge and renders a title without a doc link", () => {
    render(
      <ActorInstances
        primitives={[
          prim({ title: "Mystery Primitive", docId: null, isUnknown: true, instances: [inst()] }),
        ]}
      />,
    );
    expect(screen.getByText("unknown")).toBeInTheDocument();
    // Title with no docId is a plain span, not a link.
    expect(screen.getByText("Mystery Primitive").tagName).not.toBe("A");
  });

  it("falls back to the 'Other' category label when category is null", () => {
    render(<ActorInstances primitives={[prim({ category: null, categoryDocId: null, instances: [inst()] })]} />);
    expect(screen.getAllByText("Other").length).toBeGreaterThan(0);
  });
});

describe("ActorInstances parameter value rendering", () => {
  function renderWithParam(p: InstanceParam) {
    render(<ActorInstances primitives={[prim({ instances: [inst({ signalParams: [p] })] })]} />);
  }

  it("links an EVM address to a block explorer", () => {
    const addr = "0x" + "a".repeat(40);
    renderWithParam(param("Vault", addr));
    const link = screen.getByTitle(addr);
    expect(link).toHaveAttribute("href", expect.stringContaining("0x"));
  });

  it("truncates a 32-byte rate-limit hash", () => {
    const hash = "0x" + "b".repeat(64);
    renderWithParam(param("Rate Limit", hash));
    expect(screen.getByTitle(hash)).toHaveTextContent("…");
  });

  it("renders the placeholder phrase as 'To Be Specified'", () => {
    renderWithParam(param("Detail", "This will be specified in a future iteration."));
    expect(screen.getByText("To Be Specified")).toBeInTheDocument();
  });

  it("renders a markdown UUID link as an atlas link and a URL link as an anchor", () => {
    render(
      <ActorInstances
        primitives={[
          prim({
            instances: [
              inst({
                signalParams: [
                  param("Ref", "see [the doc](00000000-0000-4000-8000-000000000001) now"),
                  param("Site", "[Example](https://example.com)"),
                ],
              }),
            ],
          }),
        ]}
      />,
    );
    const docLink = screen.getByText("the doc");
    expect(docLink).toHaveAttribute("href", expect.stringContaining("00000000-0000-4000-8000-000000000001"));
    const site = screen.getByText("Example");
    expect(site).toHaveAttribute("href", "https://example.com");
  });

  it("renders the parameter key and a plain string value", () => {
    renderWithParam(param("Threshold", "42%"));
    expect(screen.getByText("Threshold")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("links the instance displayName when it has a docId", () => {
    render(<ActorInstances primitives={[prim({ instances: [inst({ displayName: "Linked Inst", docId: "d9" })] })]} />);
    const link = screen.getByText("Linked Inst");
    expect(link).toHaveAttribute("href", expect.stringContaining("d9"));
  });

  it("renders instance status pills", () => {
    render(<ActorInstances primitives={[prim({ instances: [inst({ status: "Suspended" })] })]} />);
    const section = screen.getByRole("heading", { name: "Instances" }).closest("section")!;
    expect(within(section).getByText("Suspended")).toBeInTheDocument();
  });
});
