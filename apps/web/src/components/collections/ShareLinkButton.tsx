import { useCopyState } from "../../hooks/useCopyState";

// Copies the public /c/<id> link — a saved collection's id, or a conversation's
// (see SharedCollectionOpener) — and says so for a moment. Falls back to a
// prompt when the clipboard is unavailable.
export function ShareLinkButton({ id }: { id: string }) {
  const { copied, copy } = useCopyState(1500);

  const share = async () => {
    const url = `${window.location.origin}/c/${id}`;
    if (!(await copy(url))) window.prompt("Copy this share link:", url);
  };

  return (
    <button
      type="button"
      className="mono text-xs px-3 py-1.5 rounded border transition-colors hover:bg-[var(--hover)]"
      style={{ borderColor: "var(--border)", color: "var(--tan-3)" }}
      onClick={share}
      title="Copy a shareable link (anyone with the link can open it)"
    >
      {copied ? "Copied!" : "Share"}
    </button>
  );
}
