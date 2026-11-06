// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TitleDiff } from "./TitleDiff";

afterEach(cleanup);

describe("TitleDiff", () => {
  it("strikes only the changed word when most of the title stays", () => {
    const { container } = render(<TitleDiff prev="Rate Limits For Prime Agent Vaults" next="Rate Limits For Executor Agent Vaults" />);
    expect([...container.querySelectorAll("del")].map((e) => e.textContent)).toEqual(["Prime"]);
    expect([...container.querySelectorAll("ins")].map((e) => e.textContent)).toEqual(["Executor"]);
    expect(container.querySelector("p")?.textContent).toBe("Title changed: Rate Limits For PrimeExecutor Agent Vaults");
  });

  it("swaps the whole title when most of its words changed, as a body line would", () => {
    const { container } = render(<TitleDiff prev="First Loss Capital" next="Junior Risk Capital" />);
    expect(container.querySelector("del")?.textContent).toBe("First Loss Capital");
    expect(container.querySelector("ins")?.textContent).toBe("Junior Risk Capital");
  });

  it("keeps a rename with no shared word on one inline line", () => {
    const { container } = render(<TitleDiff prev="Operational GovOps" next="Sky Primitives" />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("del")?.textContent).toBe("Operational GovOps");
    expect(container.querySelector("ins")?.textContent).toBe("Sky Primitives");
  });
});
