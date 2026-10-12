import { useEffect, useRef } from "react";
import { useLocationProperty } from "wouter/use-browser-location";

const currentHash = () => window.location.hash;
const ALIAS = /^[\w-]+$/;

/**
 * The element a fragment names: by id, then by an alias in its
 * `data-anchor-alias` list (the first in document order), each as written and
 * then lowercased, so `#Change-history` finds `change-history`.
 */
export function arrivalTarget(fragment: string): HTMLElement | null {
  for (const id of new Set([fragment, fragment.toLowerCase()])) {
    const el = document.getElementById(id) ?? (ALIAS.test(id) ? document.querySelector<HTMLElement>(`[data-anchor-alias~="${id}"]`) : null);
    if (el) return el;
  }
  return null;
}

/** Opens every collapsed `<details>` the element is, or sits in, so the target shows. */
function reveal(el: HTMLElement): void {
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
}

function decode(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

/**
 * Scrolls to the element the URL hash names and marks it `data-arrived` (the
 * outline in index.css), once per arrival: when `scopeKey` (the page's
 * identity) or the hash changes. An unrelated re-render — the sidebar filter,
 * the drawer — must not run it again, or it would snap the reader back to the
 * target. A page whose targets render only once data loads passes `readyKey`,
 * which changes as it loads; it retries the arrival until the target is found,
 * and never after. The target, and every `<details>` it is in, is opened.
 */
export function useArrivalTarget(scopeKey: string, readyKey = ""): void {
  const hash = useLocationProperty(currentHash);
  const landed = useRef<string | null>(null);
  useEffect(() => {
    const id = decode(hash);
    if (!id) return;
    const arrival = `${scopeKey}#${id}`;
    if (landed.current === arrival) return;
    const el = arrivalTarget(id);
    document.querySelectorAll("[data-arrived]").forEach((p) => {
      if (p !== el) p.removeAttribute("data-arrived");
    });
    if (!el) return;
    landed.current = arrival;
    reveal(el);
    el.setAttribute("data-arrived", "");
    el.scrollIntoView({ behavior: "instant", block: "start" });
  }, [scopeKey, hash, readyKey]);
}
