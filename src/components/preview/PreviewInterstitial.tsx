import { useEffect, useState, type ReactNode } from "react";

// Fork-only click-through. PR / canonical-branch previews are publicly proposed
// and attributable, so they pass straight through; a fork has no public proposal,
// so the first visit per session shows a one-click warning before any content.
// Dismissal is per preview sha per session (sessionStorage).

interface Meta {
  repo: string;
  ref: string;
  forkOwner?: string;
  trustTier?: string;
  newAddresses?: number;
  behindBy?: number;
}

const CANONICAL_PREFIX = "sky-ecosystem/";

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
  const isFork = !!meta && !meta.repo.startsWith(CANONICAL_PREFIX);
  if (!isFork) return children;

  const owner = meta!.forkOwner ?? meta!.repo.split("/")[0];
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 px-6"
      style={{ height: "100vh", textAlign: "center", background: "var(--bg)" }}
    >
      <div className="mono text-xs" style={{ color: "var(--red)", fontWeight: 700, letterSpacing: "0.1em" }}>
        UNREVIEWED FORK
      </div>
      <p className="text-lg max-w-xl" style={{ color: "var(--tan)" }}>
        This is unreviewed fork content from <strong>{owner}</strong> — not the live Sky Atlas, and not
        proposed to it.
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
      <button
        type="button"
        className="px-4 py-1.5 rounded mono text-sm"
        style={{ background: "var(--hover)", border: "1px solid var(--border)", color: "var(--tan)" }}
        onClick={() => {
          sessionStorage.setItem(ackKey, "1");
          setAcked(true);
        }}
      >
        I understand — view the fork
      </button>
      <a href={import.meta.env.BASE_URL} className="text-sm" style={{ color: "var(--accent)" }}>
        ← back to the live atlas
      </a>
    </div>
  );
}
