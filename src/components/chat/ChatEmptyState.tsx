import { useEffect, useState } from "react";
import { Link } from "../Link";
import { SparkMark } from "./glyphs";
import { track } from "../../lib/analytics";
import { listConversations, type ConversationSummary } from "../../lib/conversationsApi";
import { ROUTES } from "../../lib/routes";
import type { PageContextView } from "./pageContext";

export const STARTERS = [
  "How are Operational Facilitators rewarded, and who signs off on the budget?",
  "What's the difference between a Prime Agent and an Aligned Delegate?",
  "Trace the governance path for an Atlas amendment.",
];

// Starters shown when the chat opens on a report page that has a backing
// atlas_report_* tool — they steer the user toward querying the report itself.
const reportStarters = (name: string): string[] => [
  `Summarize the ${name} report.`,
  "What are the most notable rows here, and why?",
  "Where does this report's data come from in the atlas?",
];

const RECENT_LIMIT = 3;

interface ChatEmptyStateProps {
  authed: boolean;
  context: PageContextView;
  onSend: (text: string) => void;
  onOpenConversation: (id: string, title: string | null) => void;
}

// The signed-in, empty-thread view: a page-aware greeting + starter prompts,
// plus (once loaded) a "Continue a previous chat" pointer into the user's
// history. That section is strictly additive — a failed or empty list just
// renders nothing, never an error surface over the primary starters.
export function ChatEmptyState({ authed, context, onSend, onOpenConversation }: ChatEmptyStateProps) {
  const [recent, setRecent] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    if (!authed) return;
    let alive = true;
    listConversations()
      .then((rows) => alive && setRecent(rows.slice(0, RECENT_LIMIT)))
      .catch(() => {
        // Additive-only — leave `recent` empty rather than surfacing an error.
      });
    return () => {
      alive = false;
    };
  }, [authed]);

  const onReport = !!context.reportTool && !!context.reportName;
  const title = onReport ? `Viewing the ${context.reportName} report` : "Ask the Atlas";
  const body = onReport
    ? "I can pull this full report in one call and answer questions about it — total it, filter it, or dig into any single row. Ask away."
    : "A research agent over the Sky Atlas. It already knows the page you're on — answers cite atlas docs you can open inline.";
  const starters = onReport ? reportStarters(context.reportName!) : STARTERS;

  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 mb-1">
        <SparkMark size={16} />
        <span className="rlc-empty-title">{title}</span>
      </div>
      <p className="rlc-empty-body">{body}</p>
      <div className="flex flex-col gap-[7px]">
        {starters.map((s, i) => (
          <button
            key={s}
            className="rlc-starter"
            onClick={() => {
              track("chat_starter_click", { product: "chat", starter: i });
              onSend(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="mt-5 pt-4 border-t border-border">
          <div className="text-xs mono text-tan-3 mb-2">continue a previous chat</div>
          <div className="flex flex-col gap-[7px]">
            {recent.map((c) => (
              <button
                key={c.id}
                className="rlc-starter"
                onClick={() => {
                  track("chat_conversation_open", { product: "chat", source: "empty_state" });
                  onOpenConversation(c.id, c.title);
                }}
              >
                {c.title ?? "Untitled chat"}
              </button>
            ))}
          </div>
          <Link to={ROUTES.CONVERSATIONS} className="text-xs mono text-accent hover:underline block mt-2">
            See all conversations →
          </Link>
        </div>
      )}
    </div>
  );
}
