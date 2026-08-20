// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorList } from "./ActorList";
import type { SidebarGroup } from "@/lib/actorIndex";

afterEach(cleanup);

describe("ActorList", () => {
  it("renders group labels and actor names", () => {
    const groups: SidebarGroup[] = [
      {
        label: "Prime Agents",
        actors: [
          { id: "a1", slug: "agent-one", name: "Agent One", et: "agent", st: null, docId: null },
        ],
      },
    ];
    render(<ActorList groups={groups} selectedSlug={null} />);
    expect(screen.getByText("Prime Agents")).toBeInTheDocument();
    expect(screen.getByText("Agent One")).toBeInTheDocument();
  });

  it("marks the selected actor's link with data-active=true", () => {
    const groups: SidebarGroup[] = [
      {
        label: "Group",
        actors: [
          { id: "a1", slug: "agent-one", name: "Agent One", et: "agent", st: null, docId: null },
          { id: "a2", slug: "agent-two", name: "Agent Two", et: "agent", st: null, docId: null },
        ],
      },
    ];
    render(<ActorList groups={groups} selectedSlug="agent-two" />);
    expect(screen.getByRole("link", { name: /Agent One/ })).not.toHaveAttribute("data-active");
    expect(screen.getByRole("link", { name: /Agent Two/ })).toHaveAttribute("data-active", "true");
  });

  it("shows the Prime badge for an st of prime", () => {
    const groups: SidebarGroup[] = [
      {
        label: "Group",
        actors: [
          { id: "a1", slug: "agent-one", name: "Agent One", et: "agent", st: "prime", docId: null },
        ],
      },
    ];
    render(<ActorList groups={groups} selectedSlug={null} />);
    expect(screen.getByText("Prime")).toBeInTheDocument();
  });

  it("shows no badge for an st not in the badge map", () => {
    const groups: SidebarGroup[] = [
      {
        label: "Group",
        actors: [
          { id: "a1", slug: "agent-one", name: "Agent One", et: "agent", st: "unknown_subtype", docId: null },
        ],
      },
    ];
    render(<ActorList groups={groups} selectedSlug={null} />);
    expect(screen.queryByText("Prime")).not.toBeInTheDocument();
    expect(screen.queryByText("Exec")).not.toBeInTheDocument();
    expect(screen.queryByText("Core Exec")).not.toBeInTheDocument();
  });
});
