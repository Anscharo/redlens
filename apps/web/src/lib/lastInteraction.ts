// A short trail of what the user last clicked or focused, attached to a
// feedback submission. A free-text report plus a console dump still leaves the
// hardest triage question open — what did they click right before it broke? —
// and the path in is usually what makes a report reproducible.
//
// Same discipline as consoleBuffer.ts: describe eagerly, store only strings.
// Retaining an element would keep a detached subtree alive, and the trail
// outlives the DOM it points at.
//
// Never captured: the value of any input/textarea/select (that's what the user
// typed), anything inside the chat panel (their own words), anything marked
// .ph-no-capture, and the feedback trigger itself.
import { redact } from "@/lib/redact";

export const MAX_INTERACTIONS = 5;
const MAX_ENTRY_CHARS = 160;
const MAX_LABEL_CHARS = 80;
const MAX_CLASSES = 3;

// Subtrees whose content is the user's own input rather than app chrome.
const EXCLUDED = "[data-feedback-ui], .rlc-panel, .ph-no-capture";
// The element a user means when they click — a label inside a button is the
// button, as far as "what did they click" goes.
const MEANINGFUL = "a, button, [role=button], [data-node-id]";
const VALUE_BEARING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

interface Interaction {
  t: number;
  text: string;
}

let ring: Interaction[] = [];

function classes(el: Element): string {
  const cls = typeof el.className === "string" ? el.className.trim() : "";
  if (!cls) return "";
  return "." + cls.split(/\s+/).slice(0, MAX_CLASSES).join(".");
}

// Relative, so the descriptor never carries an absolute URL (mirrors
// toRelativeUrl in analytics.ts — the host travels separately).
function relativeHref(el: Element): string {
  const raw = el.getAttribute("href");
  if (!raw) return "";
  try {
    const u = new URL(raw, "http://x");
    return ` [href=${u.pathname}${u.search}]`;
  } catch {
    return "";
  }
}

// aria-label / title / own text — never a form control's value.
function label(el: Element): string {
  if (VALUE_BEARING.has(el.tagName)) return "";
  const raw = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent ?? "";
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  const clipped =
    collapsed.length > MAX_LABEL_CHARS ? collapsed.slice(0, MAX_LABEL_CHARS - 1) + "…" : collapsed;
  return ` "${clipped}"`;
}

/** Describes an element as a short, PII-free string, or null when it sits in
 *  an excluded subtree. Pure — reads the DOM but mutates nothing. */
export function describeElement(el: Element | null): string | null {
  if (!el || typeof el.closest !== "function") return null;
  if (el.closest(EXCLUDED)) return null;

  const target = el.closest(MEANINGFUL) ?? el;
  const tag = target.tagName.toLowerCase();
  const id = target.id ? `#${target.id}` : "";
  // A value-bearing control is identified by name, never by what's in it.
  const name = VALUE_BEARING.has(target.tagName) ? target.getAttribute("name") : null;
  const nameAttr = name ? ` [name=${name}]` : "";
  const nodeEl = target.closest("[data-node-id]");
  const node = nodeEl ? ` [node=${nodeEl.getAttribute("data-node-id")}]` : "";

  const out = `${tag}${id}${classes(target)}${nameAttr}${relativeHref(target)}${node}${label(target)}`;
  return redact(out).slice(0, MAX_ENTRY_CHARS);
}

function record(el: Element | null, now: number): void {
  const text = describeElement(el);
  if (!text) return;
  // Collapse a repeat of the same target (pointerdown then focusin on one
  // click) into a single entry rather than burning two ring slots.
  if (ring.length && ring[ring.length - 1].text === text) {
    ring[ring.length - 1].t = now;
    return;
  }
  ring.push({ t: now, text });
  if (ring.length > MAX_INTERACTIONS) ring.shift();
}

function age(ms: number): string {
  if (ms < 1000) return "just now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

/** The trail, oldest first, each entry prefixed with its age at read time. */
export function interactionTrail(now: number = Date.now()): string[] {
  return ring.map((i) => `${age(now - i.t)}: ${i.text}`);
}

/** Test seam — drops everything recorded so far. */
export function resetInteractions(): void {
  ring = [];
}

/** Listens for pointerdown + focusin in the capture phase. Additive and never
 *  preventDefault()s, so it cannot interfere with the app's own handlers —
 *  same constraint as the console listeners. Returns an uninstall function. */
export function installInteractionCapture(target: Document = document): () => void {
  const onPointer = (e: Event) => record(e.target as Element | null, Date.now());
  const onFocus = (e: Event) => record(e.target as Element | null, Date.now());
  target.addEventListener("pointerdown", onPointer, true);
  target.addEventListener("focusin", onFocus, true);
  return () => {
    target.removeEventListener("pointerdown", onPointer, true);
    target.removeEventListener("focusin", onFocus, true);
  };
}
