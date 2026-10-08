import { useCallback, useEffect, useRef } from "react";
import { glide } from "../../lib/animatedScroll";
import type { AtlasTab } from "../../lib/atlasTab";

type SectionRefs = Partial<Record<AtlasTab, HTMLElement | null>>;

function scrollToSection(container: HTMLElement | null, section: HTMLElement | null | undefined, animate: boolean) {
  if (!container || !section) return;
  const delta = section.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const target = Math.max(0, container.scrollTop + delta);
  if (animate) glide(container, target);
  else container.scrollTop = target;
}

// Keeps the right panel's active section at the top of its scroll area. `tab` is
// the section the reader asked for, `active` the one shown (they differ while the
// asked-for section is hidden). Only a new ask glides; anything else that moves
// `active` (a section's data arriving, a doc change) repositions instantly.
export function useSectionScroll(tab: AtlasTab, active: AtlasTab, id: string, onTabChange: (t: AtlasTab) => void) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<SectionRefs>({});
  const prev = useRef<{ tab: AtlasTab; id: string } | null>(null);
  useEffect(() => {
    const animate = prev.current !== null && prev.current.tab !== tab && prev.current.id === id;
    scrollToSection(scrollRef.current, sectionRefs.current[active], animate);
    prev.current = { tab, id };
  }, [tab, active, id]);
  // Clicking a pill always brings its section to the top — even the already-active
  // one, which wouldn't change `active` and so wouldn't trigger the effect above.
  const selectSection = useCallback((view: AtlasTab) => {
    if (active === view) scrollToSection(scrollRef.current, sectionRefs.current[view], true);
    onTabChange(view);
  }, [active, onTabChange]);
  return { scrollRef, sectionRefs, selectSection };
}
