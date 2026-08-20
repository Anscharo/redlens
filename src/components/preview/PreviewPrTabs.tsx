import { useEffect, useState, type ReactNode } from "react";
import { track } from "@/lib/analytics";
import type { Entry } from "./types";

// The tabbed list under the /preview input box. "my recent prs" is the
// browser-local intersection list (passed in as `entries`); "open atlas prs"
// lazily loads every PR currently open against sky-ecosystem/next-gen-atlas
// (GET /api/preview/open-prs, server-cached). Both link into the preview gate.

const ATLAS_PRS_URL = "https://github.com/sky-ecosystem/next-gen-atlas/pulls";
const href = (pid: string) => `${import.meta.env.BASE_URL}preview/${encodeURIComponent(pid)}`;

interface OpenPr {
  number: number;
  title: string;
  author: string;
  draft: boolean;
  updatedAt: string;
}

type Tab = "recent" | "open";

export function PreviewPrTabs({ entries }: { entries: Entry[] }) {
  const [tab, setTab] = useState<Tab>("recent");
  const [openPrs, setOpenPrs] = useState<OpenPr[] | null>(null); // null = not loaded yet
  const [openErr, setOpenErr] = useState(false);
  const [attempt, setAttempt] = useState(0); // bumped by the retry button to re-run the load

  // Load the open-PR list the first time that tab is shown — not on mount, so
  // visitors who only want their recent previews never trigger a GitHub call.
  // On error openPrs stays null (not []), so the load re-runs on a later tab
  // activation or a Retry click instead of latching the failure forever.
  useEffect(() => {
    if (tab !== "open" || openPrs !== null) return;
    let live = true;
    setOpenErr(false);
    fetch(`${import.meta.env.BASE_URL}api/preview/open-prs`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((d) => live && setOpenPrs(Array.isArray(d) ? d : []))
      .catch(() => live && setOpenErr(true));
    return () => {
      live = false;
    };
  }, [tab, openPrs, attempt]);

  const select = (t: Tab) => {
    setTab(t);
    track("preview_tab", { product: "preview", tab: t });
  };

  return (
    <section className="w-full max-w-xl mt-10">
      <div className="flex items-center gap-4 mb-3 border-b" style={{ borderColor: "var(--border)" }}>
        <TabButton active={tab === "recent"} onClick={() => select("recent")}>
          my recent previews{entries.length ? ` · ${entries.length}` : ""}
        </TabButton>
        <TabButton active={tab === "open"} onClick={() => select("open")}>
          open atlas prs{openPrs ? ` · ${openPrs.length}` : ""}
        </TabButton>
        <a
          href={ATLAS_PRS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mono text-[10px] ml-auto pb-2"
          style={{ color: "var(--tan-3)" }}
        >
          all on github ↗
        </a>
      </div>

      {tab === "recent" ? (
        entries.length === 0 ? (
          <p className="mono text-xs py-2" style={{ color: "var(--tan-3)" }}>
            No previews opened in this browser yet.
          </p>
        ) : (
          <ul>
            {entries.map((e) => (
              <li key={e.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <a
                  href={href(e.id)}
                  className="flex items-baseline gap-3 py-2 px-1 hover:bg-hover rounded"
                  onClick={() => track("preview_recent_click", { product: "preview", preview_id: e.id })}
                >
                  <span className="mono text-sm shrink-0" style={{ color: "var(--accent)" }}>{e.id}</span>
                  {e.title && <span className="text-sm truncate" style={{ color: "var(--tan)" }}>{e.title}</span>}
                  <span className="mono text-[10px] ml-auto shrink-0" style={{ color: "var(--tan-3)" }}>{e.detail}</span>
                </a>
              </li>
            ))}
          </ul>
        )
      ) : openErr ? (
        <p className="mono text-xs py-2" style={{ color: "var(--red)" }}>
          Couldn't load open atlas PRs.{" "}
          <button
            type="button"
            className="underline"
            style={{ color: "var(--accent)" }}
            onClick={() => setAttempt((a) => a + 1)}
          >
            Retry
          </button>
        </p>
      ) : openPrs === null ? (
        <p className="mono text-xs py-2" style={{ color: "var(--tan-3)" }}>Loading open atlas PRs…</p>
      ) : openPrs.length === 0 ? (
        <p className="mono text-xs py-2" style={{ color: "var(--tan-3)" }}>No open PRs against next-gen-atlas right now.</p>
      ) : (
        <ul>
          {openPrs.map((pr) => (
            <li key={pr.number} className="border-b" style={{ borderColor: "var(--border)" }}>
              <a
                href={href(`pull-${pr.number}`)}
                className="flex items-baseline gap-3 py-2 px-1 hover:bg-hover rounded"
                onClick={() => track("preview_openpr_click", { product: "preview", pr_number: pr.number })}
              >
                <span className="mono text-sm shrink-0" style={{ color: "var(--accent)" }}>#{pr.number}</span>
                <span className="text-sm truncate" style={{ color: "var(--tan)" }}>{pr.title}</span>
                <span className="mono text-[10px] ml-auto shrink-0" style={{ color: "var(--tan-3)" }}>
                  {[pr.draft && "draft", pr.author && `by ${pr.author}`].filter(Boolean).join(" · ")}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mono text-xs pb-2 -mb-px border-b-2"
      style={{ color: active ? "var(--tan)" : "var(--tan-3)", borderColor: active ? "var(--accent)" : "transparent" }}
    >
      {children}
    </button>
  );
}
