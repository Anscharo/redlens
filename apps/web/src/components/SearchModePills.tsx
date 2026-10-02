import { Tooltip } from "./Tooltip";
import type { SearchMode } from "../hooks/useSearchInput";

const MODES: SearchMode[] = ["broad", "phrase", "strict"];

const MODE_CONFIG: Record<SearchMode, { symbol: string; title: string }> = {
  broad:  { symbol: "a*",  title: "Broad — prefix match on each word, case-insensitive" },
  phrase: { symbol: '"a"', title: "Phrase — literal substring, case-insensitive" },
  strict: { symbol: "Aa",  title: "Strict — literal substring, case-sensitive" },
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

/** The broad / phrase / strict match-mode pills beside the search field. */
export function SearchModePills({ mode, isMixed, onSetMode, disabledReason }: Props) {
  const disabled = isMixed || disabledReason !== undefined;
  return (
    <div className="flex gap-2 shrink-0">
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
                className="mode-pill mono w-8 flex items-center justify-center text-[11px] rounded-sm border disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  color: active ? "var(--tan)" : "var(--gray)",
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--hover)" : "transparent",
                }}
              >
                {MODE_CONFIG[m].symbol}
              </button>
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}
