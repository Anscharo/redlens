import type { ChatEvent } from "./api";
import type { ChatEventOf } from "./applyEvent";
import { applyEvent } from "./applyEvent";
import type { StreamCore } from "./streamCore";
import { downloadFile } from "../../lib/csvDownload";
import { absolutizeAtlasLinks } from "@/lib/routes";
import { track } from "../../lib/analytics";

// Auto-download the file the moment it arrives (CSV keeps the Excel BOM;
// markdown doesn't). A gesture-strict browser (Safari) may block this async
// download — the persistent button rendered from m.exports is the
// gesture-safe fallback + re-download. Markdown leaves the app, so the in-app
// citation links (`/atlas/<id>`) are rewritten to absolute URLs that resolve
// outside it; CSV stays byte-for-byte as built server-side. Returns the
// rewritten event, which is what gets recorded on the message.
export function deliverExport(ev: ChatEventOf<"export">): ChatEventOf<"export"> {
  const content = ev.format === "markdown" ? absolutizeAtlasLinks(ev.content) : ev.content;
  const rewritten = { ...ev, content };
  try {
    downloadFile(rewritten.filename, rewritten.content, rewritten.mime, rewritten.format === "csv");
  } catch {
    // Blocked/unsupported — the fallback button still lets the user save it.
  }
  track("chat_export", { format: rewritten.format, bytes: rewritten.content.length });
  return rewritten;
}

// Routes one SSE event. `meta` and `error` touch hook-level state only and
// never patch the message; every other event goes through applyEvent's
// handler table. `done` also moves the context meter: contextUsed (the replay
// the next turn starts from) is the meter; contextTokens (one round's
// measured prompt) is the fallback for a server that sends only that.
export function dispatchStreamEvent(core: StreamCore, ev: ChatEvent): void {
  if (ev.type === "meta") return core.setConversation(ev.conversationId);
  if (ev.type === "error") {
    core.setError(ev.message);
    return core.finalizeLast({ failed: true });
  }
  const applied = ev.type === "export" ? deliverExport(ev) : ev;
  core.patchLast((m) => applyEvent(m, applied));
  if (ev.type === "done") core.setContextTokens(ev.contextUsed ?? ev.contextTokens ?? null);
}
