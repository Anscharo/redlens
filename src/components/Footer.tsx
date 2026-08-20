import { useEffect, useState } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useSWUpdate } from "../hooks/useSWUpdate";
import { useAtlasVersion } from "../hooks/useAtlasVersion";
import { useBuildBehind } from "../hooks/useBuildBehind";
import { loadAtlas } from "@/lib/docs";
import { loadChainState } from "@/lib/chainstate";
import { loadHealth } from "@/lib/health";
import { liveAtlasSha } from "@/lib/atlasBase";
import { useDataSource } from "@/lib/dataSource";
import { StatusPill } from "./StatusPill";
import { FooterInfo } from "./FooterInfo";
import { FooterHint } from "./FooterHint";

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
  const buildBehind = useBuildBehind();
  const [block, setBlock] = useState<string | null>(null);
  const [atlasCommit, setAtlasCommit] = useState<string | null>(null);
  const [nodeCount, setNodeCount] = useState<number>(0);
  const [previewRepo, setPreviewRepo] = useState<string | null>(null);
  // No "atlas updated" prompt in preview — the bundle is pinned to a SHA, so we
  // pass null (useAtlasVersion no-ops on null), keeping the hook call unconditional.
  // Compared against liveAtlasSha() — the sha this page was actually served/pinned
  // with — not `atlasCommit` state, which is itself sourced from the same
  // /api/health call the hook would be comparing it to (see useAtlasVersion.ts).
  const atlasNeedsUpdate = useAtlasVersion(preview ? null : liveAtlasSha());

  useEffect(() => {
    // Chain state is reused from main even in preview (on-chain, shared, served
    // by /api/chain-state). loadChainState() is the same module-level cached
    // promise the reader's annotations use, so the footer costs no extra
    // request — and its empty-on-failure fallback keeps `block` null when the
    // server has no snapshot yet (DB-less dev).
    loadChainState()
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
  // buildBehind (this JS build is older than the server's) surfaces through the
  // same pill as needRefresh (a waiting SW) — both resolve the same way: reload.
  const swOrBuildStale = needRefresh || buildBehind;
  const hasStatus = !online || swOrBuildStale || atlasNeedsUpdate;

  return (
    // The build-info row stays centered at all times; status pills overlay the
    // left corner (absolute, like FooterHint) instead of sitting in the flow,
    // so a pill appearing/disappearing never shoves the row sideways. The right
    // edge is ceded to the chat — the launcher (float) floats over the empty
    // right gutter, and when the chat is anchored the footer shrinks to its
    // left edge (see body.rlc-anchored .app-footer in chat.css).
    <footer
      className="app-footer fixed bottom-0 left-0 right-0 border-t flex items-center overflow-hidden"
      style={{ borderColor: "var(--border)", background: "var(--bg)", height: "24px", zIndex: 10 }}
    >
      {hasStatus && (
        // background occludes the centered row cleanly if the two ever overlap
        // on a narrow viewport — same trick as .footer-hint (which outranks
        // this slot at z-index 1; positioned boxes paint above flow content).
        <div className="absolute left-0 top-0 bottom-0 flex items-center" style={{ background: "var(--bg)" }}>
          {!online && (
            <StatusPill color="var(--red)" title="No network connection">
              offline
            </StatusPill>
          )}
          {swOrBuildStale && (
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
      <FooterInfo
        block={block}
        atlasCommit={atlasCommit}
        atlasRepo={atlasRepo}
        nodeCount={nodeCount}
        buildDate={buildDate}
      />
      {/* Overlays the status slot when there's a contextual hint to give — see
          FooterHint. */}
      <FooterHint />
    </footer>
  );
}
