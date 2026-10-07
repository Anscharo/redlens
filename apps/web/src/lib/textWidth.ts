import { prepareWithSegments, measureNaturalWidth } from "@chenglou/pretext";

const cache = new Map<string, number>();

/**
 * Rendered width of `text` in `font` (a CSS font shorthand), via pretext's
 * canvas measurement. Falls back to a per-character estimate where no
 * canvas exists (jsdom), so callers can size boxes in tests without mocks.
 */
export function textWidth(text: string, font: string, fallbackCharPx: number): number {
  const key = `${font} ${text}`;
  const hit = cache.get(key);
  if (hit != null) return hit;
  let w: number;
  try {
    w = measureNaturalWidth(prepareWithSegments(text, font));
    if (!Number.isFinite(w) || w <= 0) throw new Error("no measurement");
  } catch {
    w = text.length * fallbackCharPx;
  }
  cache.set(key, w);
  return w;
}
