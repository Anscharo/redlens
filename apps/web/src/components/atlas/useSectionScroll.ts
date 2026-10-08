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

// Keeps the right panel's active section at the top of its scroll area: a glide
// when the reader picks another section, a silent instant reposition on doc
// navigation, nothing extra on load.
export function useSectionScroll(active: AtlasTab, id: string, onTabChange: (t: AtlasTab) => void) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<SectionRefs>({});
  // A doc change that also moves the active section (the new doc lacks it) is
  // still doc navigation, so it repositions without a glide.
  const prev = useRef<{ active: AtlasTab; id: string } | null>(null);
  useEffect(() => {
    const animate = prev.current !== null && prev.current.active !== active && prev.current.id === id;
    scrollToSection(scrollRef.current, sectionRefs.current[active], animate);
    prev.current = { active, id };
  }, [active, id]);
  // Clicking a pill always brings its section to the top — even the already-active
  // one, which wouldn't change `active` and so wouldn't trigger the effect above.
  const selectSection = useCallback((view: AtlasTab) => {
    if (active === view) scrollToSection(scrollRef.current, sectionRefs.current[view], true);
    onTabChange(view);
  }, [active, onTabChange]);
  return { scrollRef, sectionRefs, selectSection };
}
