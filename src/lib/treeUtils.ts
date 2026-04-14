import { prepareWithSegments, layoutWithLines, type PreparedTextWithSegments } from "@chenglou/pretext";

const FONT = "10px Lora";

const preparedCache = new Map<string, PreparedTextWithSegments>();

export function getPrepared(text: string): PreparedTextWithSegments {
  let p = preparedCache.get(text);
  if (!p) {
    p = prepareWithSegments(text, FONT);
    preparedCache.set(text, p);
  }
  return p;
}

export function truncateTitle(title: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const prepared = getPrepared(title);
  const result = layoutWithLines(prepared, maxWidth, 14);
  if (result.lineCount <= 1) return title;
  return result.lines[0].text.trimEnd() + "\u2026";
}
