import type { ChatEvent } from "./api";
import type { ChatEventOf } from "./applyEvent";
import { applyEvent } from "./applyEvent";
import type { StreamCore } from "./streamCore";
import { downloadFile } from "../../lib/csvDownload";
import { absolutizeAtlasLinks } from "@/lib/routes";
import { track } from "../../lib/analytics";

// Auto-downloads on arrival; Safari may block it, so the button rendered from
// m.exports is the fallback. Markdown leaves the app, so its atlas links are
// made absolute. Returns the event as recorded on the message.
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

// `meta` and `error` touch hook state only. On `done`, contextUsed drives the
// meter; contextTokens is the fallback for a server that sends only that.
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
