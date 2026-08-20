// Module-level scroll position cache. Keyed by the full URL (pathname + search)
// so distinct filter/pagination states each remember their own scroll.
// Cache survives SPA navigation within the tab; clears on tab reload.
const memory = new Map<string, number>();

export function saveScroll(key: string, top: number): void {
  if (top > 0) memory.set(key, top);
  else memory.delete(key);
}

export function getSavedScroll(key: string): number | undefined {
  return memory.get(key);
}
