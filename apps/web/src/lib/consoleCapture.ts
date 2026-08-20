// Installs the console ring buffer (consoleBuffer.ts) over the real console
// and the window error events. Split from the buffer itself so the buffer
// stays a pure data structure with no global side effects.

import { argsToText, formatArg } from "./consoleFormat";
import { defaultBuffer, type ConsoleBuffer } from "./consoleBuffer";

const PATCHED_METHODS = ["error", "warn", "log", "info"] as const;
type PatchedMethod = (typeof PATCHED_METHODS)[number];

// Module-level re-entrancy guard: if a serializer (or something it calls)
// itself logs, that inner call is passed through untouched instead of
// recursing back into capture.
let capturing = false;

function guarded(fn: () => void): void {
  if (capturing) return;
  capturing = true;
  try {
    fn();
  } catch {
    // Capture must never break the real console/error-handling call it wraps.
    // ErrorBoundary calls console.error *during* error handling, so a throw
    // here would mask the original error.
  } finally {
    capturing = false;
  }
}

// Patches console.error/warn/log/info on `target` (default the real console)
// and, in a browser, additively listens for uncaught errors / unhandled
// rejections. `target` is injectable so tests can pass a fake console and run
// under plain node (no jsdom). Returns an uninstall function that restores the
// original methods by identity and removes both listeners.
export function installConsoleCapture(
  buf: ConsoleBuffer = defaultBuffer,
  target: Console = console,
): () => void {
  const originals = {} as Record<PatchedMethod, Console[PatchedMethod]>;
  for (const m of PATCHED_METHODS) {
    const original = target[m];
    originals[m] = original;
    target[m] = ((...args: unknown[]) => {
      guarded(() => buf.push(m, argsToText(args)));
      return original.apply(target, args);
    }) as Console[PatchedMethod];
  }

  let onError: ((e: ErrorEvent) => void) | undefined;
  let onRejection: ((e: PromiseRejectionEvent) => void) | undefined;
  if (typeof window !== "undefined") {
    // capture: true is required so resource-load failures (which don't bubble)
    // are seen. Never preventDefault(), never assign window.onerror /
    // onunhandledrejection — posthog-js installs its own handling
    // (capture_exceptions: true), and these listeners must coexist with it
    // additively, not clobber it.
    onError = (e: ErrorEvent) => {
      guarded(() => {
        if (e.target && e.target !== window) {
          const el = e.target as unknown as { tagName?: string; src?: string; href?: string };
          buf.push("resource", `<${(el.tagName ?? "?").toLowerCase()} src=${el.src ?? el.href ?? ""}>`);
        } else {
          buf.push("uncaught", formatArg(e.error ?? e.message));
        }
      });
    };
    onRejection = (e: PromiseRejectionEvent) => {
      guarded(() => buf.push("rejection", formatArg(e.reason)));
    };
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
  }

  return () => {
    for (const m of PATCHED_METHODS) target[m] = originals[m];
    if (typeof window !== "undefined") {
      if (onError) window.removeEventListener("error", onError, true);
      if (onRejection) window.removeEventListener("unhandledrejection", onRejection);
    }
  };
}
