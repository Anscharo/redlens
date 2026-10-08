import { useCallback, useEffect, useRef } from "react";
import { glide } from "../../lib/animatedScroll";
import type { AtlasTab } from "../../lib/atlasTab";

// Keeps the right panel's active section at the top of its scroll area: a glide
// when the reader picks another section, a silent instant reposition on doc
// navigation, nothing extra on load.
export function useSectionScroll(active: AtlasTab, id: string, onTabChange: (t: AtlasTab) => void) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<AtlasTab, HTMLElement | null>>>({});
  const scrollToSection = useCallback((view: AtlasTab, animate: boolean) => {
    const container = scrollRef.current;
    const section = sectionRefs.current[view];
    if (!container || !section) return;
    const delta = section.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const target = Math.max(0, container.scrollTop + delta);
    if (animate) glide(container, target);
    else container.scrollTop = target;
  }, []);
  // A doc change that also moves the active section (the new doc lacks it) is
  // still doc navigation, so it repositions without a glide.
  const mounted = useRef(false);
  const prev = useRef({ active, id });
  useEffect(() => {
    const animate = mounted.current && prev.current.active !== active && prev.current.id === id;
    scrollToSection(active, animate);
    prev.current = { active, id };
    mounted.current = true;
  }, [active, id, scrollToSection]);
  // Clicking a pill always brings its section to the top — even the already-active
  // one, which wouldn't change `active` and so wouldn't trigger the effect above.
  const selectSection = useCallback(
    (view: AtlasTab) => {
      if (active === view) scrollToSection(view, true);
      onTabChange(view);
    },
    [active, onTabChange, scrollToSection],
  );
  return { scrollRef, sectionRefs, selectSection };
}
