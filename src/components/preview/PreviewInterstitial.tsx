import { useEffect, useState, type ReactNode } from "react";
import { initAnalytics, track } from "../../lib/analytics";

// Low-trust click-through: shown on first visit per session for (a) fork
// previews whose owner is NOT trusted-tier (whitelisted orgs / atlas-merged
// contributors skip it — the fork banner still carries provenance + address
// notes), and (b) PR previews whose author is unknown-tier (no merged history
// — opening a PR is cheap, so PR-ness alone earns no clean treatment).
// Dismissal is per preview sha per session (sessionStorage).

interface Meta {
  repo: string;
  ref: string;
  prAuthor?: string;
  forkOwner?: string;
  trustTier?: string;
  newAddresses?: number;
  addressCheckFailed?: boolean;
  behindBy?: number;
}

export function PreviewInterstitial({ sha, base, children }: { sha: string; base: string; children: ReactNode }) {
  const ackKey = `preview-ack-${sha}`;
  const [acked, setAcked] = useState(() => sessionStorage.getItem(ackKey) === "1");
  const [meta, setMeta] = useState<Meta | null | undefined>(undefined);

  useEffect(() => {
    if (acked) return;
    let live = true;
    fetch(`${base}meta.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => live && setMeta(m))
      .catch(() => live && setMeta(null));
    return () => {
      live = false;
    };
  }, [base, acked]);

  if (acked) return children;
  if (meta === undefined) return null; // meta loading — blank beat, no flash of content
  const isFork = !!meta?.forkOwner && meta.trustTier !== "trusted";
  const lowTrustPr = !meta?.forkOwner && meta?.trustTier === "unknown";
  // meta === null (fetch failed) → both false → fail open; our server's fault, fork banner still shows.
  if (!isFork && !lowTrustPr) return children;

  const owner = meta!.forkOwner ?? meta!.prAuthor ?? meta!.repo.split("/")[0];
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 px-6"
      style={{ height: "100vh", textAlign: "center", background: "var(--bg)" }}
    >
      <div className="mono text-xs" style={{ color: "var(--red)", fontWeight: 700, letterSpacing: "0.1em" }}>
        {isFork ? "UNREVIEWED FORK" : "UNREVIEWED PROPOSAL"}
      </div>
      <p className="text-lg max-w-xl" style={{ color: "var(--tan)" }}>
        {isFork ? (
          <>
            This is unreviewed fork content from <strong>{owner}</strong> — not the live Sky Atlas, and
            not proposed to it.
          </>
        ) : (
          <>
            This is unreviewed proposed content from <strong>{owner}</strong> — a pull request that has
            not been reviewed or merged into the live Sky Atlas.
          </>
        )}
      </p>
      {meta!.trustTier === "unknown" && (
        <p className="text-sm max-w-xl" style={{ color: "var(--red)" }}>
          {owner} has never had a PR accepted into the canonical atlas.
        </p>
      )}
      {(meta!.newAddresses ?? 0) > 0 && (
        <p className="text-sm max-w-xl" style={{ color: "var(--red)" }}>
          This fork references {meta!.newAddresses} on-chain address
          {meta!.newAddresses === 1 ? "" : "es"} not present in the live atlas. Do not send funds to or
          interact with addresses from unreviewed content.
        </p>
      )}
      {meta!.addressCheckFailed && (
        <p className="text-sm max-w-xl" style={{ color: "var(--red)" }}>
          We couldn't verify whether this fork introduces new on-chain addresses. Treat any address in
          unreviewed content with caution — do not send funds to or interact with it.
        </p>
      )}
      <button
        type="button"
        className="px-4 py-1.5 rounded mono text-sm"
        style={{ background: "var(--hover)", border: "1px solid var(--border)", color: "var(--tan)" }}
        onClick={() => {
          // Analytics isn't initialised yet (App mounts only after ack) — do it here.
          initAnalytics();
          track("preview_interstitial", { product: "preview", action: "proceed", sha });
          sessionStorage.setItem(ackKey, "1");
          setAcked(true);
        }}
      >
        I understand — view the fork
      </button>
      <a
        href={import.meta.env.BASE_URL}
        className="text-sm"
        style={{ color: "var(--accent)" }}
        onClick={() => {
          initAnalytics();
          track("preview_interstitial", { product: "preview", action: "cancel", sha });
        }}
      >
        ← back to the live atlas
      </a>
    </div>
  );
}
