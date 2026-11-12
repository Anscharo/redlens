import type { FeatureGroup } from "../features-types.ts";

export const preview: FeatureGroup = {
    key: "preview",
    title: "Preview",
    href: "/preview",
    blurb: "Read any Atlas PR, branch, or fork as a live redlined Atlas with every change marked inline.",
    features: [
      {
        name: "Previewing a change",
        what: "Turn a proposed Atlas edit into a readable, redlined view before it lands.",
        how: [
          "Open Preview (the `Previews` link in the top bar on wider screens) and paste an Atlas PR, branch, or fork URL — or pick one from the open-PRs tab.",
          "The `my recent previews` tab lists the previews you've opened — signed in, your own list follows your account to any browser; signed out, it is whatever this browser remembers. Your eight most recent private-repo previews appear too, while you're signed in with an account that can still see those repos.",
          "To preview a private repo, paste its GitHub URL or pull-request URL into the private-repo box — a pull request is redlined against its own base branch, a branch against the repo's default branch, and the default branch itself against the live sky-ecosystem/next-gen-atlas:main. If a private pull request is missing Pull requests: Read, the preview bar links to GitHub so the person who installed the App can grant it, then reload. If the App was granted every repository on the account, the bar names the one repo it needs and links to GitHub to narrow that grant. Dismiss hides that Access notice on this browser.",
          "Use the `compare against … instead` link on the preview bar to switch bases. The `← back` link at its left returns to the Preview page, whose own `← back` returns to wherever you opened it from — the live Atlas or the preview you were reading.",
          "The `Filter` button above the tree narrows the tree and reader to what the preview changed: pick `Changed only`, then untick New or Edited to drop that kind, tick `Renumber-only changes` under Exclude to hide documents whose only change is a doc number, or tick a flag to narrow further (Retitled, Identity swap, Reused doc number) — each row shows its count. `All` or the × beside the button clears it, and the filter stays on as you follow links between documents. The rollup badge counts what moved.",
          "Watch for the ⚠ UUID-swap warning (a document's identity changed) and the build-error detail if the preview failed to build.",
          "History inside a preview is scoped to that preview, so you can see the change against what it edits, with retitles, renumberings and type changes shown the same way as in a document's history. When the branch has more than one commit, press `By commit` under that change to list each commit on the branch that changed the document, newest first, with its diff, linked to the commit on GitHub; merge commits show as markers between them. The list streams in behind a progress bar the first time anyone asks for that preview, and the switch is kept in the page's URL, so a shared link opens with it on.",
          "Open the Atlas agent inside a preview and ask \"review this PR\" — the launcher reads \"Ask about this PR\" and it already knows which preview you're in. Links in its answer to the PR's documents open in the preview.",
        ],
        note: "Previewing a private fork requires signing in with GitHub, and only works if your account can already see that repository. The same applies when Chat reads a private preview, and a chat that read one reopens only while your account can still see that repository. Where the deployment's stronger chat model has a large context window, a PR review reads the whole change at once instead of a page at a time.",
      },
    ],
  };
