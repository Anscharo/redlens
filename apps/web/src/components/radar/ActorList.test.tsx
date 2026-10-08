// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

  describe("sub nav", () => {
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
    const subpages = new Map([
      ["spark", ["settlements", "history", "instances", "pau"] as const],
      ["grove", ["history", "instances"] as const],
    ]);

    it("makes an actor with subpages a disclosure linking Info then each subpage", () => {
      render(<ActorList groups={groups} selectedSlug="spark" subpages={subpages} />);
      const row = screen.getByRole("button", { name: /Spark/ });
      expect(row).toHaveAttribute("aria-expanded", "true");
      const sub = document.getElementById(row.getAttribute("aria-controls")!)!;
      const links = [...sub.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
      expect(links).toEqual([
        ["Info", "/radar/spark"],
        ["Settlements", "/radar/spark/settlements"],
        ["History", "/radar/spark/history"],
        ["Primitive instances", "/radar/spark/instances"],
        ["PAUs", "/radar/spark/pau"],
      ]);
      expect(sub.querySelector("a")).toHaveAttribute("data-active", "true");
      // An actor with no subpages stays a plain link.
      expect(screen.getByRole("link", { name: /Keel/ })).toHaveAttribute("href", "/radar/keel");
    });

    it("on a subpage, opens every actor offering it and marks the open page", () => {
      render(<ActorList groups={groups} selectedSlug="spark" page="history" subpages={subpages} />);
      expect(screen.getByRole("button", { name: /Grove/ })).toHaveAttribute("aria-expanded", "true");
      const active = document.querySelectorAll('[data-active="true"]');
      expect([...active].map((a) => a.getAttribute("href"))).toEqual(["/radar/spark/history"]);
      cleanup();
      render(<ActorList groups={groups} selectedSlug="spark" page="settlements" subpages={subpages} />);
      expect(screen.getByRole("button", { name: /Grove/ })).toHaveAttribute("aria-expanded", "false");
    });

    it("toggles a closed actor open without navigating, and takes its links out of the tab order while shut", () => {
      render(<ActorList groups={groups} selectedSlug={null} subpages={subpages} />);
      const grove = screen.getByRole("button", { name: /Grove/ });
      expect(grove).toHaveAttribute("aria-expanded", "false");
      const sub = document.getElementById(grove.getAttribute("aria-controls")!)!;
      expect(sub.querySelector("a")).toHaveAttribute("tabindex", "-1");
      fireEvent.click(grove);
      expect(grove).toHaveAttribute("aria-expanded", "true");
      expect(sub.querySelector("a")).not.toHaveAttribute("tabindex");
    });
  });
});
