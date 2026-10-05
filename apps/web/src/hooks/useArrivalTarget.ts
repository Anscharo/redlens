import { useEffect } from "react";
import { useLocationProperty } from "wouter/use-browser-location";

const currentHash = () => window.location.hash;

/**
 * Scrolls to the element the URL hash names and marks it `data-arrived` (the
 * outline in index.css), once per arrival: when `scopeKey` (the page's
 * identity) or the hash changes. An unrelated re-render — the sidebar filter,
 * the drawer — must not run it again, or it would snap the reader back to the
 * target. Every target is rendered synchronously by the page that calls this,
 * so one pass after commit finds it.
 */
export function useArrivalTarget(scopeKey: string): void {
  const hash = useLocationProperty(currentHash);
  useEffect(() => {
    const id = hash.slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    document.querySelectorAll("[data-arrived]").forEach((p) => {
      if (p !== el) p.removeAttribute("data-arrived");
    });
    el?.setAttribute("data-arrived", "");
    el?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [scopeKey, hash]);
}
