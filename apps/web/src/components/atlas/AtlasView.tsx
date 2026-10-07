import type { CSSProperties } from "react";
import type { AtlasNode } from "@/types";
import { Breadcrumbs } from "../Breadcrumbs";
import { AtlasActionsContext } from "./AtlasActionsContext";
import { AtlasLoadFallback, RetryNotice } from "./AtlasLoadStates";
import { AtlasReaderRow } from "./AtlasReaderRow";
import { DrawerToggle } from "../Drawer";
import { useAtlasView } from "../../hooks/useAtlasView";
import { useDataSource } from "../../lib/dataSource";
import type { AtlasTab } from "../../lib/atlasTab";

interface AtlasViewProps {
  id: string;
  onNavigate: (id: string) => void;
  view: AtlasTab;
  onViewChange: (v: AtlasTab) => void;
  splitId: string | null;
  onSplitChange: (id: string | null) => void;
  onOpenTree?: () => void;
}

const COLUMN_STYLE: CSSProperties = { minHeight: 0 };
const BAR_STYLE: CSSProperties = { borderBottom: "1px solid var(--border)" };
const noop = () => {};

function AtlasViewHeader({ id, ancestors, onOpenTree }: { id: string; ancestors: AtlasNode[]; onOpenTree?: () => void }) {
  return (
    <div className="flex items-center" style={BAR_STYLE}>
      <DrawerToggle label="Atlas" onClick={onOpenTree} breakpoint={1050} />
      {id && <Breadcrumbs ancestors={ancestors} />}
    </div>
  );
}

// Non-blocking: the shallow tree already rendered — this only means "view all
// descendants", deep-linked deep nodes and enrichments aren't available yet.
// Clears once a retry (or the in-flight load) lands.
function DeepLoadBanner({ onRetry }: { onRetry: () => void }) {
  const message = "Couldn't finish loading the full atlas — showing what loaded so far.";
  const className = "flex items-center gap-2 px-3 py-1 text-xs mono text-red";
  return <RetryNotice className={className} style={BAR_STYLE} message={message} onRetry={onRetry} />;
}

export function AtlasView({ id, onNavigate, view, onViewChange, splitId, onSplitChange, onOpenTree }: AtlasViewProps) {
  const v = useAtlasView(id, onNavigate);
  const { preview } = useDataSource();
  const { data } = v;
  if (!data || (id && !data.atlas.docs[id])) return <AtlasLoadFallback id={id} load={v} />;
  const docNoToId = data.atlas.docNoToId;
  const actions = { navigate: v.handleNavigate, toggle: noop, splitNavigate: onSplitChange, docNoToId };
  return (
    <AtlasActionsContext.Provider value={actions}>
      <div className="flex-1 flex flex-col" style={COLUMN_STYLE}>
        <AtlasViewHeader id={id} ancestors={v.ancestors} onOpenTree={onOpenTree} />
        {v.deepError && !data.complete && <DeepLoadBanner onRetry={v.retry} />}
        <AtlasReaderRow
          id={id}
          data={data}
          annotations={v.annotations}
          view={view}
          onViewChange={onViewChange}
          onNavigate={onNavigate}
          selectable={!preview}
          selectedId={v.selectedId}
          splitId={splitId}
          onSplitChange={onSplitChange}
          agentByDoc={v.agentByDoc}
        />
      </div>
    </AtlasActionsContext.Provider>
  );
}
