// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorChain } from "./ActorChain";
import type { ActorChain as ActorChainData, ChainNode } from "@/lib/actorIndex";

afterEach(cleanup);

function node(overrides: Partial<ChainNode> = {}): ChainNode {
  return {
    id: "id-1",
    slug: "prime-agent",
    name: "Prime Agent Co",
    et: "agent",
    st: null,
    docId: null,
    ...overrides,
  };
}

function emptyChain(): ActorChainData {
  return { primes: [], executors: [], facilitators: [], govops: [] };
}

describe("ActorChain", () => {
  it("renders the Related Parties heading and role labels with actor links", () => {
    const chain: ActorChainData = {
      primes: [node({ id: "p1", slug: "prime-1", name: "Prime One" })],
      executors: [node({ id: "e1", slug: "exec-1", name: "Exec One" })],
      facilitators: [node({ id: "f1", slug: "facil-1", name: "Facil One" })],
      govops: [node({ id: "g1", slug: "govops-1", name: "GovOps One" })],
    };
    render(<ActorChain chain={chain} currentSlug="someone-else" />);

    expect(screen.getByText("Related Parties")).toBeInTheDocument();
    expect(screen.getByText("Prime Agent")).toBeInTheDocument();
    expect(screen.getByText("Executor Agent")).toBeInTheDocument();
    expect(screen.getByText("Facilitator")).toBeInTheDocument();
    expect(screen.getByText("GovOps")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Prime One" });
    expect(link).toHaveAttribute("href", expect.stringContaining("prime-1"));
  });

  it("filters out the node matching currentSlug", () => {
    const chain: ActorChainData = {
      primes: [
        node({ id: "p1", slug: "prime-1", name: "Prime One" }),
        node({ id: "p2", slug: "self-slug", name: "Self Node" }),
      ],
      executors: [],
      facilitators: [],
      govops: [],
    };
    render(<ActorChain chain={chain} currentSlug="self-slug" />);
    expect(screen.getByText("Prime One")).toBeInTheDocument();
    expect(screen.queryByText("Self Node")).not.toBeInTheDocument();
  });

  it("renders nothing when every group is empty", () => {
    const { container } = render(<ActorChain chain={emptyChain()} currentSlug="x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when every node equals currentSlug", () => {
    const chain: ActorChainData = {
      primes: [node({ id: "p1", slug: "self-slug", name: "Self Node" })],
      executors: [],
      facilitators: [],
      govops: [],
    };
    const { container } = render(<ActorChain chain={chain} currentSlug="self-slug" />);
    expect(container).toBeEmptyDOMElement();
  });
});
