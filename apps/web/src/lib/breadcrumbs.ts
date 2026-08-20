import { prepare, layout } from "@chenglou/pretext";
import { shortenTitle } from "@/lib/shortenTitle";

export { shortenTitle } from "@/lib/shortenTitle";

const BREADCRUMB_FONT = "12px 'Source Code Pro', monospace";
const SEPARATOR = " / ";

export function fitBreadcrumbs(titles: string[], availableWidth: number): string[] {
  if (titles.length <= 2) return titles;
  if (titles.length <= 4) return titles.map((t) => shortenTitle(t, 48, 0.33));
  if (titles.length <= 6) return titles.map((t) => shortenTitle(t, 36, 0.66));

  const steps: Array<{ maxChars: number; abbrRatio: number }> = [
    { maxChars: 26, abbrRatio: 0.66 },
    { maxChars: 22, abbrRatio: 0.8 },
    { maxChars: 16, abbrRatio: 1.0 },
    { maxChars: 10, abbrRatio: 1.0 },
    { maxChars: 8, abbrRatio: 1.0 },
  ];

  for (const { maxChars, abbrRatio } of steps) {
    const shortened = titles.map((t) => shortenTitle(t, maxChars, abbrRatio));
    const fullText = shortened.join(SEPARATOR);
    const prepared = prepare(fullText, BREADCRUMB_FONT);
    const { lineCount } = layout(prepared, availableWidth, 16);
    if (lineCount <= 1) return shortened;
  }

  return titles.map((t) => shortenTitle(t, 6, 1.0));
}
