import { Tooltip } from "./Tooltip";
import { SEARCH_PILL_CLASS, searchPillStyle } from "./searchPill";
import type { SearchMode } from "../hooks/useSearchInput";

const MODES: SearchMode[] = ["broad", "phrase", "strict"];

const MODE_CONFIG: Record<SearchMode, { symbol: string; name: string; title: string }> = {
  broad:  { symbol: "a*",  name: "Broad",  title: "Broad — prefix match on each word, case-insensitive" },
  phrase: { symbol: '"a"', name: "Phrase", title: "Phrase — literal substring, case-insensitive" },
  strict: { symbol: "Aa",  name: "Strict", title: "Strict — literal substring, case-sensitive" },
};

const MIXED_TOOLTIP = "Advanced mode enabled due to mixed use of quoted and unquoted terms";

interface Props {
  mode: SearchMode;
  /** Partial or mixed quotes in the free text: no single pill describes it. */
  isMixed: boolean;
  onSetMode: (mode: SearchMode) => void;
  /**
   * Why the pills cannot be used right now, or undefined when they can. All
   * three describe how a STRING is matched, so a lane that matches no strings
   * disables them rather than offering a setting with no effect. The text
   * becomes their tooltip, so it has to say why.
   */
  disabledReason?: string;
}

/**
 * The broad / phrase / strict match-mode controls beside the search field:
 * three pills on wide screens, one button that steps through the modes on
 * phones, where three pills crowd the field.
 */
export function SearchModePills({ mode, isMixed, onSetMode, disabledReason }: Props) {
  const disabled = isMixed || disabledReason !== undefined;
  return (
    <>
      <div className="hidden sm:flex gap-2 shrink-0">
        {MODES.map((m) => {
          // Nothing reads as active while they are off: a lit pill would assert a
          // match rule that is not being applied.
          const active = !disabled && mode === m;
          const tooltip = disabledReason ?? (isMixed ? MIXED_TOOLTIP : MODE_CONFIG[m].title);
          return (
            <Tooltip key={m} content={tooltip}>
              <span className="flex">
                <button
                  type="button"
                  onClick={() => onSetMode(m)}
                  aria-label={tooltip}
                  aria-pressed={active}
                  disabled={disabled}
                  className={SEARCH_PILL_CLASS}
                  style={searchPillStyle(active)}
                >
                  {MODE_CONFIG[m].symbol}
                </button>
              </span>
            </Tooltip>
          );
        })}
      </div>
      <ModeCycleButton mode={mode} disabled={disabled} reason={disabledReason ?? (isMixed ? MIXED_TOOLTIP : undefined)} onSetMode={onSetMode} />
    </>
  );
}

/** Phones only: shows the current mode; each tap moves to the next one. */
function ModeCycleButton({ mode, disabled, reason, onSetMode }: {
  mode: SearchMode;
  disabled: boolean;
  reason: string | undefined;
  onSetMode: (mode: SearchMode) => void;
}) {
  const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  const label = reason ?? `${MODE_CONFIG[mode].title}. Press for ${MODE_CONFIG[next].name} (${MODE_CONFIG[next].symbol}).`;
  return (
    <button
      type="button"
      onClick={() => onSetMode(next)}
      aria-label={label}
      disabled={disabled}
      data-mode={mode}
      className={`${SEARCH_PILL_CLASS} sm:hidden shrink-0`}
      style={searchPillStyle(!disabled)}
    >
      {MODE_CONFIG[mode].symbol}
    </button>
  );
}
