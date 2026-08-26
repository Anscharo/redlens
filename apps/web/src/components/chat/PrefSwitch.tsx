// A labeled on/off row using the rlc-menu-item / rlc-switch markup shared by
// every switch in the nav menu. Deliberately plain `on`/`onChange` rather
// than typed over a specific prefs record — ProfileButton's Account panel
// uses it for reduce-motion (a ChatPrefs boolean); it used to also carry the
// binary light-mode toggle, but the theme store is now a registry of N
// themes and that row is ThemePicker.tsx (a radiogroup, not a switch).
// Extracted next to MenuRow.tsx, the established home for shared menu-row
// primitives.
export function PrefSwitch({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: () => void;
}) {
  return (
    <button className="rlc-menu-item" onClick={onChange} role="switch" aria-checked={on}>
      <span className="text-[12.5px]">{label}</span>
      <span className="rlc-switch" data-on={on}>
        <span className="rlc-switch-knob" />
      </span>
    </button>
  );
}
