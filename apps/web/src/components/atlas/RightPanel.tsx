import { ATLAS_TABS } from "../../lib/atlasTab";
import { PanelPills } from "./PanelPills";
import { usePanelBodies } from "./usePanelBodies";
import { useSectionScroll } from "./useSectionScroll";
import type { RightPanelProps } from "./panelSections";

// A section's title bar: a pill-styled label anchored by a rule across the rest
// of the width, marking the start of a panel section. The active section's bar
// stays highlighted so the selection is always clear.
function SectionDivider({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`rl-section-divider${active ? " rl-section-divider--active" : ""}`}>
      <span className="rl-section-label">{label}</span>
    </div>
  );
}

// The reader's right panel: every shown section in one scroll area, with a pill
// bar that jumps between them.
export function RightPanel(props: RightPanelProps) {
  const { id, tab, onTabChange } = props;
  const { bodies, counts } = usePanelBodies(props);
  const shown = ATLAS_TABS.filter((t) => bodies[t] != null);
  const active = shown.includes(tab) ? tab : shown[0];
  const { scrollRef, sectionRefs, selectSection } = useSectionScroll(active, id, onTabChange);
  return (
    <>
      <PanelPills shown={shown} active={active} counts={counts} onSelect={selectSection} />
      <div className="overflow-y-auto flex-1" ref={scrollRef}>
        <div className="px-4 py-5">
          {shown.map((t) => (
            <section key={t} className="rl-section" ref={(el) => { sectionRefs.current[t] = el; }} data-testid={`${t}-panel`}>
              <SectionDivider label={t} active={active === t} />
              {bodies[t]}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
