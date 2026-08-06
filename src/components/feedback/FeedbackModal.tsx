import { useRef, useState, type FormEvent } from "react";
import { Modal } from "../Modal";
import { ghostBtn, primaryBtn } from "../modalStyles";
import { ShortcutsList } from "./ShortcutsList";
import { useFeedbackContext } from "../../lib/feedbackContext";
import { submitFeedback, type FeedbackApiError } from "../../lib/feedbackApi";
import { track } from "../../lib/analytics";

const MAX_MESSAGE_LEN = 2000;
const MIN_MESSAGE_LEN = 2;

type Status = "form" | "sending" | "done" | "error";

// Free-text feedback form in the shared Modal shell, plus the shortcuts
// reference (ShortcutsList) so "?" doubles as both. Success swaps the form
// for a thank-you IN PLACE — deliberately does not auto-close, so the user
// can still read the shortcuts below.
export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — always sent, real users never fill it
  const [status, setStatus] = useState<Status>("form");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const openedAtRef = useRef(Date.now());
  const buildContext = useFeedbackContext();

  const trimmed = message.trim();
  const valid = trimmed.length >= MIN_MESSAGE_LEN && trimmed.length <= MAX_MESSAGE_LEN;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || status === "sending") return;
    setStatus("sending");
    setErrorCode(null);

    // Console snapshot happens HERE, at submit, not at open — it must cover
    // everything up to the send.
    const ctx = buildContext();
    const elapsedMs = Date.now() - openedAtRef.current;

    try {
      await submitFeedback({ message: trimmed, website, elapsedMs, ...ctx });
      // 200 (silently discarded — honeypot/too-fast/duplicate) and 201
      // (inserted) both land here and both show the thank-you: never reveal
      // which anti-spam filter tripped.
      track("feedback_submitted", {
        path: ctx.context.route,
        node_id: ctx.nodeId,
        chars: trimmed.length,
        console_entries: ctx.console.length,
        preview: Boolean(ctx.previewId),
        elapsed_ms: elapsedMs,
      });
      setStatus("done");
    } catch (err) {
      const apiErr = err as FeedbackApiError;
      const code = apiErr.code ?? "server_error";
      setErrorCode(code);
      setRetryAfter(apiErr.retryAfterSeconds ?? null);
      track("feedback_error", { code });
      setStatus("error");
    }
  }

  return (
    <Modal label="Feedback & shortcuts" onClose={onClose} width={420}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--tan)", margin: 0 }}>Feedback</h2>

      {status === "done" ? (
        <p aria-live="polite" style={{ fontSize: 13, color: "var(--tan)", margin: 0 }}>
          Thanks — we got it.
        </p>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label htmlFor="feedback-message" style={{ fontSize: 12, color: "var(--tan-3)" }}>
            What&rsquo;s broken, confusing, or missing?
          </label>
          <textarea
            id="feedback-message"
            className="ph-no-capture"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={MAX_MESSAGE_LEN}
            autoFocus
            rows={5}
            style={{
              background: "var(--bg)",
              color: "var(--tan)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "8px 10px",
              fontSize: 13,
              resize: "vertical",
              outline: "none",
            }}
          />
          <p className="mono" style={{ fontSize: 10, color: "var(--tan-3)", margin: 0, textAlign: "right" }}>
            {message.length}/{MAX_MESSAGE_LEN}
          </p>

          {/* Honeypot: real users never see or fill this. Off-screen via
              absolute positioning (NOT display:none / type=hidden — both are
              trivially detected by bots), tabIndex -1 so keyboard users skip
              past it entirely. Always sent, empty for a real submitter. */}
          <input
            type="text"
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}
          />

          {status === "error" && (
            <p aria-live="polite" style={{ fontSize: 11, color: "var(--red)", margin: 0 }}>
              {errorCode === "rate_limited"
                ? `Too many reports for now — try again in ${Math.ceil((retryAfter ?? 60) / 60)} min.`
                : "Couldn't send that — please try again."}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={onClose} className="mono" style={ghostBtn}>
              cancel
            </button>
            <button
              type="submit"
              disabled={!valid || status === "sending"}
              className="mono"
              style={{ ...primaryBtn, opacity: !valid || status === "sending" ? 0.6 : 1 }}
            >
              {status === "sending" ? "sending…" : "send"}
            </button>
          </div>
        </form>
      )}

      <ShortcutsList />
    </Modal>
  );
}
