// @vitest-environment jsdom
// useSectionScroll glides only when the reader asks for another section. A
// section appearing late (its data arriving after mount) or a doc change moves
// the shown section without a glide.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSectionScroll } from "./useSectionScroll";
import type { AtlasTab } from "../../lib/atlasTab";

const glide = vi.fn();
vi.mock("../../lib/animatedScroll", () => ({ glide: (...args: unknown[]) => glide(...args) }));

beforeEach(() => glide.mockClear());

type Props = { tab: AtlasTab; active: AtlasTab; id: string };

function mount(initial: Props) {
  const onTabChange = vi.fn();
  const hook = renderHook((p: Props) => useSectionScroll(p.tab, p.active, p.id, onTabChange), { initialProps: initial });
  // Every section sits 100px below the container's top.
  hook.result.current.scrollRef.current = document.createElement("div");
  for (const t of ["notes", "onchain", "history", "glossary"] as const) {
    const el = document.createElement("section");
    el.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    hook.result.current.sectionRefs.current[t] = el;
  }
  return { ...hook, onTabChange };
}

describe("useSectionScroll", () => {
  it("glides when the asked-for section changes", () => {
    const { rerender } = mount({ tab: "notes", active: "notes", id: "a" });
    rerender({ tab: "history", active: "history", id: "a" });
    expect(glide).toHaveBeenCalledTimes(1);
  });

  it("does not glide when a deep-linked section's data arrives after mount", () => {
    // ?view=glossary before the glossary loads shows notes, then glossary appears.
    const { rerender } = mount({ tab: "glossary", active: "notes", id: "a" });
    rerender({ tab: "glossary", active: "glossary", id: "a" });
    expect(glide).not.toHaveBeenCalled();
  });

  it("does not glide on doc navigation, even when the shown section changes", () => {
    const { rerender } = mount({ tab: "onchain", active: "onchain", id: "a" });
    rerender({ tab: "onchain", active: "history", id: "b" });
    expect(glide).not.toHaveBeenCalled();
  });

  it("re-glides to the active section when its pill is clicked again", () => {
    const { result, onTabChange } = mount({ tab: "notes", active: "notes", id: "a" });
    result.current.selectSection("notes");
    expect(glide).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("notes");
  });
});
