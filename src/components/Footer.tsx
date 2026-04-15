import { useEffect, useState } from "react";

const BASE = import.meta.env.BASE_URL;
const REPO = "https://github.com/Anscharo/redlens";

export function Footer() {
  const [block, setBlock] = useState<string | null>(null);
  const [chainTime, setChainTime] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}chain-state.json`)
      .then(r => r.json())
      .then(d => {
        if (d.block) setBlock(d.block);
        if (d.generatedAt) setChainTime(d.generatedAt);
      })
      .catch(() => {});
  }, []);

  const buildDate = __BUILD_TIME__.slice(0, 19).replace("T", " ");

  return (
    <footer className="shrink-0 border-t flex items-center justify-end gap-0 overflow-hidden"
      style={{ borderColor: "var(--border)", background: "var(--bg)", height: "24px" }}>
      {block && (
        <>
          <FooterItem title={chainTime ? `chain state generated ${chainTime}` : undefined}>
            <a href={`https://etherscan.io/block/${block}`} target="_blank" rel="noopener noreferrer"
              className="hover:underline" style={{ color: "var(--tan-3)" }}>
              <span className="hidden sm:inline">chain state @ block&nbsp;</span>{Number(block).toLocaleString()}
            </a>
          </FooterItem>
          <Sep />
        </>
      )}
      <FooterItem>
        <a href={`https://github.com/sky-ecosystem/next-gen-atlas/commit/${__ATLAS_COMMIT__}`}
          target="_blank" rel="noopener noreferrer"
          className="hover:underline" style={{ color: "var(--tan-3)" }}>
          <span className="hidden sm:inline">atlas&nbsp;</span>{__ATLAS_COMMIT__}
        </a>
      </FooterItem>
      <Sep />
      <FooterItem>
        <a href={`${REPO}/commit/${__COMMIT_HASH__}`} target="_blank" rel="noopener noreferrer"
          className="hover:underline" style={{ color: "var(--tan-3)" }}>
          <span className="hidden sm:inline">redlens&nbsp;</span>{__COMMIT_HASH__}
        </a>
      </FooterItem>
      <Sep />
      <FooterItem><span className="hidden sm:inline">updated </span>{buildDate}</FooterItem>
      <Sep />
      <FooterItem>
        <a href={REPO} target="_blank" rel="noopener noreferrer"
          className="hover:underline" style={{ color: "var(--accent)" }}>
          src
        </a>
      </FooterItem>
    </footer>
  );
}

function FooterItem({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="mono px-3 whitespace-nowrap" title={title}
      style={{ fontSize: "10px", color: "var(--tan-3)", lineHeight: "24px" }}>
      {children}
    </span>
  );
}

function Sep() {
  return <span style={{ color: "var(--border)", fontSize: "10px", userSelect: "none" }}>|</span>;
}
