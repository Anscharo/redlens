import type { FeatureGroup } from "../features-types.ts";

export const chat: FeatureGroup = {
    key: "chat",
    title: "Chat",
    blurb:
      "Ask the Atlas questions from any page and get answers backed by inline sources and a verification badge.",
    features: [
      {
        name: "Asking the Atlas",
        what: "A page-aware agent that reads the Sky Atlas and cites the documents it used.",
        how: [
          "Click the Redline Portal Chat launcher in the bottom-right (it shows ⌘K), or press ⌘K / Ctrl-K — it already knows the document or report you're viewing.",
          "Ask it what the app can do, or what it can do itself — it answers from this guide, and keeps the two apart.",
          "Ask about a Prime Agent's monthly settlement dollars — Chat uses an isolated helper on Soter Labs workbooks / Sky Forum and says those figures are not from the Atlas.",
          "Ask across every Prime at once — top venues by revenue, ecosystem totals, a range of months, or which month was the largest — not just one Prime at a time.",
          "Ask it to draft a message to someone else explaining what the Atlas says; the draft carries links to the source documents, and you can export it to send.",
          "Ask what's on the horizon — it lists open Atlas pull requests — or name one (a number or a GitHub PR link) and ask it to review the PR, or whether a proposed document reads like similar documents already in the Atlas. It builds the PR's preview if nobody has yet, which can take a minute.",
          "Type `/teach` followed by a note at the start of a message to remember a miss on later chats — teachings stay on your account. Keep each note to one fact in a sentence or two (under 60 words); teach two things as two notes. Start a message with / and the composer completes the command in place; press Tab or Space to accept it.",
          "Check the answer's verification badge — it says \"no contradictions found\" when nothing in the answer conflicts with the retrieved atlas text, or lists any disputed statement alongside what the atlas actually says — and click the inline sources to jump to the cited docs; while an answer is still being checked the badge reads \"verifying…\".",
          "While it works the panel shows a checklist of what it is doing, and it stays open through the whole turn — click a step to see the lookups it made, the model's reasoning and its draft; a reopened or previously loaded chat instead starts with that checklist folded to one summary line, and clicking the line unfolds the same steps (click again to fold it back).",
          "Open the Verifying step to see each paragraph's check as it is written — flagged findings, and any possible contradiction still being confirmed.",
          "Look at the sources chips under an answer. ✓✓ means the check is sure this document states the lines that cite it. ! means this document contradicts the line that cites it — hover the chip for that line, and click the line to jump to it in the answer. ⚠ means the document does not state a line that cites it, or the reply stated what the document says when only a change record was read — hover the chip for the line. A document the reply linked without retrieving it on this turn gets no mark, because that citation was not checked. A check that is not sure enough to show is left unmarked too. The marks stay when you reopen the chat.",
          "Read the line under the verification badge: it says \"Didn't answer the question\" when the reply only announced a lookup or stalled, \"Asked you a clarifying question\" or \"Said the atlas doesn't cover this\" when that is what it did, and \"Didn't address:\" followed by any part of your question the answer skipped. When a marked citation may say otherwise, that line says so and is highlighted. Nothing is added when the answer simply answers, and the line stays when you reopen the chat.",
          "Formulas quoted from the atlas render as math, the same way they do in the document reader.",
          'Scroll up while a reply is arriving and the thread holds still — the "New messages below" button jumps you to the newest text.',
          "The usage meter under the composer shows your usage / credits; click the pie to see every limit.",
          "Dock the panel to the side with the dock icon in the header — drag its left edge to widen it, up to 55% of the window — or pop it out to a floating window. A wide docked chat folds the tree and notes sidebars so the open document stays readable.",
          'Past chats live under "Conversations" in the profile menu, and as "continue a previous chat" in an empty panel.',
          'Click "view all docs from this conversation" next to "citations · N" under an answer to open the reader with only the documents that chat has cited. The collection builds itself from the conversation, so it cannot be edited and grows as the chat cites more. Each row on the Conversations page shows its citation count and a "View Doc Collection" button.',
          "Earlier questions in the same chat stay in the thread. A very long chat is condensed on its own when the conversation is close to the model's context limit.",
        ],
        note: "Asking a question requires signing in — use the sign-in control at the right of the top bar, or the Sign in buttons in the panel.",
      },
    ],
  };
