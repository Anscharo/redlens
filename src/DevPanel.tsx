import { useLoaded } from "./hooks/useAtlasData";
import { loadDocs } from "./lib/docs";
import { AtlasLink } from "./components/AtlasLink";
import { atlasHref } from "./lib/routes";

// ---------------------------------------------------------------------------
// Dev shortcuts — type __dev <cmd> in the search box
// ---------------------------------------------------------------------------
// UUIDs are the stable identity (hardcoded here on purpose). The doc_no shown
// next to each shortcut is editorial and renumbers as the atlas is reshuffled
// (CLAUDE.md's UUID-vs-doc_no rule), so it's resolved from loaded docs data at
// render instead of being hardcoded — `note` below is everything else about
// why the node was picked, which doesn't drift the same way.
const DEV_SHORTCUTS = [
  {
    cmd: "deep",
    label: "Deepest node",
    note: "Encode Mint Function Call",
    id: "c7b2c565-d1b5-4239-9139-89762423443d",
  },
  {
    cmd: "notes",
    label: "Most annotated node",
    note: "The Core Facilitator Role In Standby Spells · 5 linked nodes",
    id: "50d68397-c09d-4f82-9e8b-44c2bcc30fd7",
  },
  {
    cmd: "history",
    label: "Most-edited node",
    note: "Current Aligned Delegates · 7 changes",
    id: "5f584db8-f8d8-4118-988c-b2bc3f68ceb7",
  },
];

export function DevPanel({ query }: { query: string }) {
  // soft: true — this is a dev-only easter egg whose links work fine even if
  // docs fail to load; the doc_no prefix just stays blank rather than the
  // whole panel throwing to the route ErrorBoundary.
  const docs = useLoaded(() => loadDocs(), { soft: true });
  const lower = query.slice("__dev".length).trim().toLowerCase();
  const matches = lower ? DEV_SHORTCUTS.filter((s) => s.cmd.startsWith(lower)) : DEV_SHORTCUTS;

  if (matches.length === 0) return null;

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      <p className="mono text-[10px] mb-4 text-tan-3">dev shortcuts</p>
      <div className="space-y-1">
        {matches.map((s) => {
          const docNo = docs?.[s.id]?.doc_no;
          return (
            <AtlasLink
              key={s.cmd}
              to={atlasHref(s.id)}
              className="hint-row w-full text-left px-3 py-2 rounded flex items-baseline gap-4"
            >
              <span className="mono text-xs shrink-0 w-20 text-accent">__{s.cmd}</span>
              <span className="text-xs font-medium shrink-0 text-tan">{s.label}</span>
              <span className="mono text-[10px] truncate text-tan-3">
                {docNo ? `${docNo} · ` : ""}
                {s.note}
              </span>
            </AtlasLink>
          );
        })}
      </div>
    </div>
  );
}
