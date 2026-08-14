const BASE = import.meta.env.BASE_URL;
const REPO = __REPO_URL__;
const PROVENANCE_HREF = `${BASE}provenance`;
const PRIVACY_HREF = `${BASE}privacy`;
const HISTORY_HREF = `${BASE}history`;
// Deep-link to the app's build commit when git gave a real sha; fall back to the
// repo root for "dev" builds (git unavailable at build time → /commit/dev 404s).
const APP_COMMIT_HREF = __COMMIT_HASH__ === "dev" ? REPO : `${REPO}/commit/${__COMMIT_HASH__}`;

type FooterInfoProps = {
  block: string | null;
  atlasCommit: string | null;
  atlasRepo: string;
  nodeCount: number;
  buildDate: string;
};

// The build-info row: chain state → atlas commit + doc count → build date →
// provenance/privacy → src (this build's commit). Always centered — the status
// pills and the contextual hint overlay the footer's left corner (see Footer /
// FooterHint) rather than sharing the flow, so nothing ever shoves this row.
export function FooterInfo({ block, atlasCommit, atlasRepo, nodeCount, buildDate }: FooterInfoProps) {
  return (
    <div className="flex items-center overflow-hidden mx-auto">
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
              <span className="hidden sm:inline">docs</span>
            </span>
          )}
        </FooterItem>
      )}
      {atlasCommit && <Sep />}
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
      <FooterItem title="what you have been reading — kept in this browser only">
        <a href={HISTORY_HREF} className="hover:underline" style={{ color: "var(--tan-3)" }}>
          history
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
          href={APP_COMMIT_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
          style={{ color: "var(--accent)" }}
        >
          src&nbsp;{__COMMIT_HASH__}
        </a>
      </FooterItem>
    </div>
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
