// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorList } from "./ActorList";
import type { SidebarGroup } from "../../lib/actorIndex";

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

  it("links Overview to /radar above the groups, active only on the index", () => {
    const groups: SidebarGroup[] = [
      {
        label: "Prime Agents",
        actors: [
          { id: "a1", slug: "agent-one", name: "Agent One", et: "agent", st: null, docId: null },
        ],
      },
    ];
    render(<ActorList groups={groups} selectedSlug={null} />);
    const overview = screen.getByRole("link", { name: "Overview" });
    expect(overview).toHaveAttribute("href", "/radar");
    expect(overview).toHaveAttribute("data-active", "true");
    // Above the first group label in document order.
    expect(
      overview.compareDocumentPosition(screen.getByText("Prime Agents")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    cleanup();
    render(<ActorList groups={groups} selectedSlug="agent-one" />);
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("data-active");
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

  it("gives an actor with settlement workbooks a sub nav that opens for the selected actor", () => {
    const groups: SidebarGroup[] = [
      {
        label: "Prime Agents",
        actors: [
          { id: "a1", slug: "spark", name: "Spark", et: "agent", st: "prime", docId: null },
          { id: "a2", slug: "grove", name: "Grove", et: "agent", st: "prime", docId: null },
          { id: "a3", slug: "keel", name: "Keel", et: "agent", st: "prime", docId: null },
        ],
      },
    ];
    render(<ActorList groups={groups} selectedSlug="spark" settledSlugs={new Set(["spark", "grove"])} />);
    // Spark and Grove are disclosures; Keel (no workbooks) stays a plain link.
    const spark = screen.getByRole("button", { name: /Spark/ });
    const grove = screen.getByRole("button", { name: /Grove/ });
    expect(screen.getByRole("link", { name: /Keel/ })).toHaveAttribute("href", "/radar/keel");
    expect(spark).toHaveAttribute("aria-expanded", "true");
    expect(grove).toHaveAttribute("aria-expanded", "false");
    // Spark's sub nav: Info is the active page, Settlements links to its chart.
    const sub = document.getElementById(spark.getAttribute("aria-controls")!)!;
    expect(sub).toHaveAttribute("data-open", "true");
    const info = within(sub).getByRole("link", { name: "Info" });
    expect(info).toHaveAttribute("href", "/radar/spark");
    expect(info).toHaveAttribute("data-active", "true");
    expect(within(sub).getByRole("link", { name: "Settlements" })).toHaveAttribute("href", "/radar/spark/settlements");
    // Clicking Grove slides its sub nav open; clicking again shuts it.
    fireEvent.click(grove);
    expect(grove).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(grove);
    expect(grove).toHaveAttribute("aria-expanded", "false");
  });

  it("opens every sub nav on a settlements page, with Settlements active for the selected actor", () => {
    const groups: SidebarGroup[] = [
      {
        label: "Prime Agents",
        actors: [
          { id: "a1", slug: "spark", name: "Spark", et: "agent", st: "prime", docId: null },
          { id: "a2", slug: "grove", name: "Grove", et: "agent", st: "prime", docId: null },
        ],
      },
    ];
    render(<ActorList groups={groups} selectedSlug="spark" page="settlements" settledSlugs={new Set(["spark", "grove"])} />);
    expect(screen.getByRole("button", { name: /Spark/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Grove/ })).toHaveAttribute("aria-expanded", "true");
    const links = screen.getAllByRole("link", { name: "Settlements" });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/radar/spark/settlements", "/radar/grove/settlements"]);
    expect(links[0]).toHaveAttribute("data-active", "true");
    expect(links[1]).not.toHaveAttribute("data-active");
    expect(screen.getAllByRole("link", { name: "Info" })[0]).not.toHaveAttribute("data-active");
  });
});
