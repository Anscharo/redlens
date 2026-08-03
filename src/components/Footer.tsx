import { useEffect, useState } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useSWUpdate } from "../hooks/useSWUpdate";
import { useAtlasVersion } from "../hooks/useAtlasVersion";
import { loadAtlas } from "../lib/docs";
import { loadHealth } from "../lib/health";
import { useDataSource } from "../lib/dataSource";
import { StatusPill } from "./StatusPill";

const BASE = import.meta.env.BASE_URL;
const REPO = __REPO_URL__;
const PROVENANCE_HREF = `${BASE}provenance`;
const PRIVACY_HREF = `${BASE}privacy`;
// Deep-link to the app's build commit when git gave a real sha; fall back to the
// repo root for "dev" builds (git unavailable at build time → /commit/dev 404s).
const APP_COMMIT_HREF = __COMMIT_HASH__ === "dev" ? REPO : `${REPO}/commit/${__COMMIT_HASH__}`;

// Plain reload: artifacts are served from immutable per-sha URLs, so the fresh
// no-cache HTML carries the new sha and the app fetches new URLs the cache has
// never seen — no cache-busting dance needed (the old atlas-data-large hack is
// gone with the StaleWhileRevalidate rule that required it).
function reloadWithFreshAtlas() {
  window.location.reload();
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
    if (preview) {
      // Preview bundle is pinned and already loaded by the reader — reuse it for
      // the commit + count (no extra fetch).
      loadAtlas(base).then((b) => {
        setAtlasCommit(b.atlasCommit);
        setNodeCount(Object.keys(b.docs).length);
      }).catch(() => {});
    } else {
      // Live atlas: read the sha + count from /api/health (shared with
      // useAtlasVersion), NOT loadAtlas — which would pull the full deep bundle
      // (~730 KB gz) just to render a footer line.
      loadHealth().then((d) => {
        if (!d) return;
        if (d.atlas_sha) setAtlasCommit(d.atlas_sha);
        if (typeof d.docs === "number") setNodeCount(d.docs);
      }).catch(() => {});
    }
  }, [base, preview]);

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
              update available
            </StatusPill>
          )}
          {atlasNeedsUpdate && (
            <StatusPill
              as="button"
              color="var(--accent)"
              title="Atlas content has been updated — click to reload"
              onClick={reloadWithFreshAtlas}
            >
              atlas updated
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
          href={APP_COMMIT_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
          style={{ color: "var(--tan-3)" }}
        >
          <span className="hidden sm:inline">redline-atlas&nbsp;</span>
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
      <FooterItem title="what data we collect and how it's used">
        <a href={PRIVACY_HREF} className="hover:underline" style={{ color: "var(--tan-3)" }}>
          privacy
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

