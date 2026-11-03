import type { ComponentProps, CSSProperties } from "react";
import { Loading } from "../Loading";
import type { LoadedData } from "@/lib/atlasHelpers";

/** The rule under each full-width bar at the top of the reader. */
export const NOTICE_BAR_STYLE: CSSProperties = { borderBottom: "1px solid var(--border)" };

interface NoticeBarProps extends ComponentProps<"div"> {
  message: string;
  action: string;
  onAction: () => void;
}

/** A one-line message with one text button, such as a load failure's "retry". */
export function NoticeBar({ message, action, onAction, ...props }: NoticeBarProps) {
  return (
    <div {...props}>
      <p>{message}</p>
      <button type="button" onClick={onAction} className="text-xs mono text-accent hover:underline">
        {action}
      </button>
    </div>
  );
}

// What the reader shows instead of a doc while the bundle can't render it yet.
// docs-shallow.json is load-bearing: a genuine failure gets an error with a
// retry instead of an eternal spinner. A depth-6 node isn't in the shallow
// first-paint set, so a missing id waits for the deep tier (complete) before
// it counts as not found — unless the deep load failed, in which case it will
// never arrive on its own and the reader offers a retry.
export function AtlasLoadFallback({
  id,
  load,
}: {
  id: string;
  load: { data: LoadedData | null; shallowError: Error | null; deepError: Error | null; retry: () => void };
}) {
  const { data, shallowError, deepError, retry } = load;
  if (!data) {
    if (!shallowError) return <Loading />;
    const className = "flex-1 flex flex-col items-center justify-center gap-3 py-24 text-sm text-red";
    return <NoticeBar className={className} message="Couldn't load the atlas." action="retry" onAction={retry} />;
  }
  if (data.complete) {
    return <div className="flex items-center justify-center py-24 text-sm text-red">Node not found: {id}</div>;
  }
  if (!deepError) return <Loading />;
  return (
    <NoticeBar
      className="flex flex-col items-center justify-center gap-3 py-24 text-sm text-red"
      message="Couldn't finish loading the atlas, so this node can't be shown yet."
      action="retry"
      onAction={retry}
    />
  );
}
