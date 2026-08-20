import { useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Modal } from "../Modal";
import { Link } from "../Link";
import { ROUTES } from "@/lib/routes";
import { ghostBtn, primaryBtn } from "../modalStyles";
import { HoneypotField } from "./HoneypotField";
import { useFeedbackContext } from "@/lib/feedbackContext";
import { interactionTrail } from "@/lib/lastInteraction";
import { submitFeedback, type FeedbackApiError } from "@/lib/feedbackApi";
import { track } from "@/lib/analytics";

const MAX_MESSAGE_LEN = 2000;
const MIN_MESSAGE_LEN = 2;

type Status = "form" | "sending" | "done" | "error";

// Free-text feedback form in the shared Modal shell, with a link out to the
// search-syntax reference. Success swaps the form for a thank-you IN PLACE
// rather than closing, so the confirmation is read rather than flashed past —
// and the reference link stays reachable in either state.
export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — always sent, real users never fill it
  const [status, setStatus] = useState<Status>("form");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const openedAtRef = useRef(Date.now());
  // Frozen at mount, unlike the console snapshot below: everything the user
  // does inside this form (focusing the textarea, hitting send) happens after
  // this line, so it can never displace what they were doing beforehand. The
  // click that opened the modal is excluded at the source, by the button's
  // data-feedback-ui marker.
  const trailRef = useRef(interactionTrail());
  const buildContext = useFeedbackContext();

  const trimmed = message.trim();
  const valid = trimmed.length >= MIN_MESSAGE_LEN && trimmed.length <= MAX_MESSAGE_LEN;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || status === "sending") return;
    setStatus("sending");
    setErrorCode(null);

    // Console snapshot happens HERE, at submit, not at open — it must cover
    // everything up to the send. The interaction trail is the opposite (see
    // trailRef above); the two are deliberately asymmetric.
    const ctx = buildContext(trailRef.current);
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

  // Both reference links navigate in place, and the card swallows the click
  // before the backdrop's close handler sees it — so without this the
  // destination renders UNDERNEATH a modal the reader then has to dismiss by
  // hand. Only a plain left click navigates (Link passes modified clicks to the
  // browser, opening a new tab and leaving this page put), so only that closes.
  const closeOnNavigate = (e: ReactMouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.button !== 0) return;
    onClose();
  };

  return (
    <Modal label="Feedback" onClose={onClose} width={420}>
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

          <HoneypotField value={website} onChange={setWebsite} />

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

      {/* The two reference links, and the only entry points to either. "Confusing
          or missing" is often really "didn't know it was there", so the features
          guide sits above the search-syntax reference — which was kept when the
          keyboard-shortcut list came out, being the one thing here people
          actually go looking for. */}
      <p style={{ margin: "4px 0 0", fontSize: 11 }}>
        <Link
          to={ROUTES.FEATURES}
          onClick={closeOnNavigate}
          className="mono"
          style={{ color: "var(--accent)" }}
        >
          Everything you can do →
        </Link>
      </p>
      <p style={{ margin: 0, fontSize: 11 }}>
        <Link
          to={ROUTES.SEARCH_HINTS}
          onClick={closeOnNavigate}
          className="mono"
          style={{ color: "var(--accent)" }}
        >
          Search syntax reference →
        </Link>
      </p>
    </Modal>
  );
}
