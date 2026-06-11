import { useEffect, useState } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useSWUpdate } from "../hooks/useSWUpdate";
import { useAtlasVersion } from "../hooks/useAtlasVersion";
import { loadAtlas } from "../lib/docs";
import { useDataSource } from "../lib/dataSource";

const BASE = import.meta.env.BASE_URL;
const REPO = __REPO_URL__;
const PROVENANCE_HREF = `${BASE}provenance`;

// Clear only the StaleWhileRevalidate atlas cache before reloading — otherwise
// the SW serves the stale docs.json and the "atlas updated" notice loops forever.
function reloadWithFreshAtlas() {
  const reload = () => window.location.reload();
  if (!("caches" in window)) { reload(); return; }
  caches.delete("atlas-data-large").then(reload, reload);
}

export function Footer() {
  const { base, preview } = useDataSource();
  const online = useOnlineStatus();
  const { needRefresh, applyUpdate } = useSWUpdate();
  const [block, setBlock] = useState<string | null>(null);
  const [atlasCommit, setAtlasCommit] = useState<string | null>(null);
  const [nodeCount, setNodeCount] = useState<number>(0);
  const [previewRepo, setPreviewRepo] = useState<string | null>(null);
  // No "atlas updated" prompt in preview — the bundle is pinned to a SHA, so we
  // pass null (useAtlasVersion no-ops on null), keeping the hook call unconditional.
  const atlasNeedsUpdate = useAtlasVersion(preview ? null : atlasCommit);

  useEffect(() => {
    // chain state is reused from main even in preview (on-chain, shared).
    fetch(`${BASE}chain-state.json`)
      .then((r) => r.json())
      .then((d) => { if (d.block) setBlock(d.block); })
      .catch(() => {});
    loadAtlas(base).then((b) => {
      setAtlasCommit(b.atlasCommit);
      setNodeCount(Object.keys(b.docs).length);
    }).catch(() => {});
  }, [base]);

  useEffect(() => {
    if (!preview) { setPreviewRepo(null); return; }
    fetch(`${base}meta.json`).then((r) => r.json()).then((m) => setPreviewRepo(m.repo)).catch(() => {});
  }, [base, preview]);

  const atlasRepo = previewRepo ?? "sky-ecosystem/next-gen-atlas";

  const buildDate = __BUILD_TIME__.slice(0, 19).replace("T", " ");
  const hasStatus = !online || needRefresh || atlasNeedsUpdate;

  return (
    // Left-packed: status (the update/offline warning) leads, then build info.
    // The right edge is ceded to the chat — the launcher (float) floats over the
    // empty right gutter, and when the chat is anchored the footer shrinks to its
    // left edge (see body.rlc-anchored .app-footer in chat.css).
    <footer
      className="app-footer fixed bottom-0 left-0 right-0 border-t flex items-center overflow-hidden"
      style={{ borderColor: "var(--border)", background: "var(--bg)", height: "24px", zIndex: 10 }}
    >
      {hasStatus && (
        <div className="flex items-center shrink-0">
          {!online && (
            <StatusPill color="var(--red)" title="No network connection">
              offline
            </StatusPill>
          )}
          {needRefresh && (
            <StatusPill
              as="button"
              color="var(--magenta)"
              title="A new version is available — click to reload"
              onClick={applyUpdate}
            >
              update available ↻
            </StatusPill>
          )}
          {atlasNeedsUpdate && (
            <StatusPill
              as="button"
              color="var(--accent)"
              title="Atlas content has been updated — click to reload"
              onClick={reloadWithFreshAtlas}
            >
              atlas updated ↻
            </StatusPill>
          )}
        </div>
      )}
      {hasStatus && <Sep />}
      <div className="flex items-center overflow-hidden">
      {block && (
        <>
          <FooterItem>
            <a
              href={`https://etherscan.io/block/${block}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              style={{ color: "var(--tan-3)" }}
            >
              <span className="hidden sm:inline">chain state @ block&nbsp;</span>
              {Number(block).toLocaleString()}
            </a>
          </FooterItem>
          <Sep />
        </>
      )}
      {atlasCommit && (
        <FooterItem>
          <a
            href={`https://github.com/${atlasRepo}/commit/${atlasCommit}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
            style={{ color: "var(--tan-3)" }}
          >
            <span className="hidden sm:inline">atlas&nbsp;</span>
            {atlasCommit.slice(0, 7)}
          </a>
          {nodeCount > 0 && (
            <span style={{ color: "var(--tan-3)" }}>
              &nbsp;·&nbsp;{nodeCount.toLocaleString()}&nbsp;
              <span className="hidden sm:inline">nodes</span>
            </span>
          )}
        </FooterItem>
      )}
      {atlasCommit && <Sep />}
      <FooterItem>
        <a
          href={`${REPO}/commit/${__COMMIT_HASH__}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
          style={{ color: "var(--tan-3)" }}
        >
          <span className="hidden sm:inline">sky-atlas&nbsp;</span>
          {__COMMIT_HASH__}
        </a>
      </FooterItem>
      <Sep />
      <FooterItem>
        <span className="hidden sm:inline">updated </span>
        {buildDate}
      </FooterItem>
      <Sep />
      <FooterItem title="data flow, scripts, outputs — how each claim is traced back to Sky Atlas.md">
        <a href={PROVENANCE_HREF} className="hover:underline" style={{ color: "var(--tan-3)" }}>
          provenance
        </a>
      </FooterItem>
      <Sep />
      <FooterItem>
        <a
          href={REPO}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
          style={{ color: "var(--accent)" }}
        >
          src
        </a>
      </FooterItem>
      </div>
    </footer>
  );
}

function FooterItem({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      className="mono px-3 whitespace-nowrap"
      title={title}
      style={{ fontSize: "10px", color: "var(--tan-3)", lineHeight: "24px" }}
    >
      {children}
    </span>
  );
}

function Sep() {
  return <span style={{ color: "var(--border)", fontSize: "10px", userSelect: "none" }}>|</span>;
}

type StatusPillProps = {
  color: string;
  title?: string;
  children: React.ReactNode;
} & (
  | { as?: "span"; onClick?: never }
  | { as: "button"; onClick: () => void }
);

function StatusPill({ as = "span", color, title, children, onClick }: StatusPillProps) {
  const style: React.CSSProperties = {
    fontSize: "10px",
    lineHeight: "24px",
    color,
    background: "var(--tan)",
    fontWeight: 600,
    letterSpacing: "0.02em",
  };
  if (as === "button") {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="mono px-3 whitespace-nowrap hover:underline cursor-pointer"
        style={style}
      >
        {children}
      </button>
    );
  }
  return (
    <span title={title} className="mono px-3 whitespace-nowrap" style={style}>
      {children}
    </span>
  );
}
