---
name: react-review
description: >
  Review checklist for RedLens React front-end code against the
  components.build principles — component API and composition, accessibility,
  state placement, and data attributes. Use when asked to review a component,
  a frontend PR or diff, audit src/components/**, check whether code follows
  the component principles, assess a11y, or do a frontend code-quality pass.
  Use it alongside a general correctness review (e.g. Claude Code's built-in
  code-review) whenever the code under review is React/frontend — it adds the
  component-specific dimensions such a review does not cover. Covers what to grep for, the
  severity ordering, findings format, and the known-debt list that should NOT
  be reported as findings.
  Keywords: review, code review, frontend review, react review, review this
  component, audit, component quality, accessibility audit, a11y review,
  props API review, does this follow the principles, components.build
  compliance, PR review, diff review, src/components.
license: MIT
metadata:
  author: anscharo
  version: "1.0"
---

# Reviewing a RedLens Front End

Reviews check code against the [components.build](https://www.components.build) principles as
adopted in the **`react-components`** and **`react-state`** skills (this repo ships no generic
code-review skill of its own; Claude Code's built-in one is separate). Read those first — this
skill is the *auditing* procedure, not a restatement of the rules.

**Out of scope:** class-merging/styling helpers (`cn`, `tailwind-merge`, CVA) and package
distribution — RedLens uses neither. Visual/token review belongs to **`ui-look-and-feel`**;
report-surface completeness belongs to **`new-report`**.

**Review the diff, not the repository.** Most of this codebase predates these rules and does
not follow them. Items marked **[new/changed components only]** apply solely to code the diff
adds or reworks — raising them against untouched files produces a review nobody can act on.
§4 lists what is never a finding.

## 1. Scope the review, then run the machines

Establish what changed before reading anything:

```bash
git diff --stat main...HEAD -- 'src/**'      # or the paths the user named
pnpm lint          # oxlint + react plugin
pnpm build:ts      # tsc -b, strict + noUnusedLocals/Parameters
pnpm test          # vitest
pnpm knip          # dead exports
```

Anything these catch is not worth your reading time — report it as a one-liner and move on.
Spend the review on what they cannot see: **API shape, composition, accessibility semantics,
and state placement.**

## 2. Severity order

Report findings in this order. Stop escalating trivia upward — a naming nit above a missing
accessible name makes the review harder to act on.

### A. Correctness and accessibility (blocking)

1. **Props not spread, or spread first.** `<div {...props} className="base" />` silently drops
   caller overrides. Grep: `rg -n '\{\.\.\.props\}' src/components | rg -v '\{\.\.\.props\} */?>'`
   then eyeball order.
2. **Non-semantic interactive elements.**
   `rg -n '<div[^>]*onClick' src/components -g '!*.test.tsx'` — production code currently has
   exactly one, the modal backdrop in `Drawer.tsx`, which is legitimate. Any new hit needs a
   reason why a `<button>` won't do. Same check for `<span onClick>`.
3. **Missing accessible name.** Icon-only buttons with no `aria-label` (the house convention —
   `sr-only` text is not used here); check any new `<button>` whose children are a single glyph
   or icon component.
4. **Missing keyboard map.** Any component with `role="menu" | "tab" | "tree" | "listbox" |
   "dialog"` or a custom popup must implement its arrow/Home/End/Escape handling and focus
   management. `rg -n 'role="(menu|tab|tablist|tree|listbox|dialog|combobox)"' src/components`,
   then confirm a matching `onKeyDown` and, for dialogs, focus trap + restore.
5. **ARIA misuse.** ARIA added where a native element exists; `aria-hidden` on something
   focusable; roles on elements that don't support them; invalid state values.
6. **Meaning by colour alone**; error states without `aria-invalid` + `aria-describedby`.
7. **Focus suppressed.** `outline: none` on `:focus` with no `:focus-visible` replacement.
8. **State bugs**: a prop copied into `useState`; a `useSyncExternalStore` snapshot returning
   a fresh object; an effect that writes state derivable during render; missing cleanup.

**Theme safety (blocking).** RedLens ships three colour schemes, so any diff
that introduces a colour is a theme change whether or not it was meant as one.

- Grep the diff for `#hex`, `rgb(`/`rgba(`, `bg-white` / `text-black` /
  `bg-gray-500`-style Tailwind defaults, `bg-[#…]` arbitrary values, and
  `color-mix()` mixing toward literal `white` or `black`. Every one of these is
  a finding: a literal cannot follow the theme, and the contrast test cannot
  see it because it only parses `index.css`. The fix is a `var(--token)`.
- A colour that *brightens* is direction-bearing. Mixing toward `white` lifts on
  dark and washes out on light; mix toward a token that flips role instead
  (`--tan` is cream on dark, near-black on light).
- A new token in `:root` must have a value in EVERY `[data-theme]` block, and a
  new FOREGROUND token needs an `AUDIT_PAIRS` entry — against `bg`, `surface`
  AND `bg-deep`, since dark's worst-case surface is the lightest and light's is
  the darkest.
- Run `pnpm exec vitest run apps/web/src/admin/` — it covers all of the above
  mechanically. Reviewing a colour by eye in one theme proves nothing about the
  other two.

### B. API and composition

9. **One component rendering several structural elements** with `title`/`footer`/`icon`-style
   escape-hatch props — should be split into parts (`Root`/`Item`/`Trigger`/`Content`/
   `Header`/`Title`/`Description`/`Footer`).
10. **[new/changed components only] Props that don't extend the native element** — no
    `React.ComponentProps<…>`, so callers can't pass `id`, `aria-*`, `data-*`, or handlers.
    Only `Link.tsx` and `AtlasLink.tsx` do this today; do not raise it against untouched files.
11. **[new/changed components only] Props type not exported**, or not named `<ComponentName>Props`.
12. **Prop name colliding with a native attribute** (`title`, `type`, `value`, `size`, `content`)
    where an override was not intended.
13. **Custom props with no JSDoc.**
14. **Per-state className props** (`openClassName`, `activeClassName`, `classes={{…}}`) instead of
    `data-state` / `data-active`. Grep: `rg -n 'ClassName[?]?:' src/components`.
15. **Prop-count budget**: a new component past ~6 props, especially with several `ReactNode`
    slots, is usually a composition in disguise — suggest splitting. `ReportShell` (~17 props)
    is a deliberate, documented exception; do not flag it or components that merely use it.
    Do **not** ask for `data-slot` — it is not used in this codebase.
16. **Polymorphism defects** (only where `as`/`asChild` is used): `any`-typed polymorphic props,
    a `div` default instead of a semantic one, invalid nesting, ARIA implied by the new element
    left unset, an inline-defined component passed to `as`, or an `asChild` child that doesn't
    spread `...props`.

### C. State placement

17. **Shareable state kept local.** A tab, filter, or selection in `useState` that a user would
    expect to bookmark or reach with the back button belongs in `useUrlState`.
18. **Bare `fetch` for atlas artifacts** (`docs.json`, `graph.json`, `relations.json`,
    `glossary.json`, `addresses*.json`, `search-index.json`) instead of `useLoaded` +
    `useDataSource()`. Grep: `rg -n 'fetch\(' src/components -g '!*.test.tsx'` — but note ~11
    legitimate hits already exist (preview `meta.json`, `api/preview/*`, chat/auth/usage API
    routes). Those are **not** `useLoaded` bugs; only atlas artifacts are.
19. **Worker construction not inline** — `new Worker(new URL(...), { type: "module", name })`
    must stay inline or Vite won't compile it.
20. **Context provider value rebuilt every render** (object literal, no `useMemo`), or a consumer
    hook that neither throws nor returns a documented default.
21. **Memoization mismatch**: `memo()` on non-list components, `useCallback` on handlers whose
    child isn't memoized, or heavy derivation with no `useMemo`.

### D. Repo conventions

22. **File over ~150 lines**, or more than 3 components per file — but see §4.
23. **`export default`** (only `App.tsx` and `NodeContentInner.tsx` are allowed), or `React.FC`.
24. **Data/row-building logic inside a component** rather than a pure `src/lib/*` module.
    This is the convention most worth defending: it is what makes the logic testable without
    React and reusable by the MCP tools.
25. **Missing co-located test**, or a DOM test without `// @vitest-environment jsdom` on line 1.
26. **Doc numbers used as identifiers.** `rg -n '"[A-Z]\.[0-9]' src/` — doc_nos are editorial and
    get renumbered; UUIDs are the stable identity. Existing ones are annotated
    `// fragile: doc_no prefix`.
27. **Dependency added without the refreshed `pnpm-lock.yaml`** — `pnpm install
    --frozen-lockfile` fails CI and both Docker builds.
28. **User-visible change with no `patch-notes.md` bullet or `featuresData.ts` entry.**

## 3. Findings format

One line per finding, most severe first:

```
src/components/atlas/RightPanel.tsx:88 — [a11y] Icon-only close button has no accessible name.
  Add aria-label="Close panel" and aria-hidden="true" on the glyph.
  (components.build accessibility: "All interactive elements must have accessible names")
```

- Always `file:line`, so it is clickable.
- Name the principle when the finding is a spec violation rather than a bug; it turns "I'd
  prefer" into "the standard says".
- Give the fix, not just the complaint.
- Say plainly when a finding is a judgement call rather than a defect.
- If the diff is clean, say so without manufacturing filler.

## 4. What is NOT a finding

Reporting these as new problems makes reviews noisy and trains people to ignore them:

- **The 31 existing files over 150 lines** (`AtlasReader.tsx` 696, `TreeSidebar.tsx` 513,
  `CollapsibleNode.tsx` 465, `ActorHistory.tsx` 437, `EntityFlow.tsx` 334, …). `CLAUDE.md`
  records these as known debt to be split *when touched*. Flag it only if the diff makes such a
  file meaningfully longer.
- **Absence of `cn` / `tailwind-merge` / CVA** — deliberately not used here.
- **Absence of `data-slot`** — deliberately not used here.
- **Native `disabled` instead of `aria-disabled`** — the house choice (18 vs 0).
- **Ad-hoc `data-*` names on existing components** (`data-active`, `data-open`, `data-hot`, …).
  New components should prefer the shared `data-state` vocabulary, but existing selectors are
  wired into `index.css` / `chat.css` and must not be renamed on a whim.
- **Existing components that don't extend `React.ComponentProps`, don't export a `<Name>Props`
  type, or don't spread props** — that describes nearly every file in the tree. Only raise it for code the
  diff actually adds or reworks.
- **Fully-controlled components with domain-named callbacks** (`onToggle`, `onSelect`,
  `onNavigate`) — the house pattern. Do not ask for `value`/`defaultValue`/`onValueChange`.
- **Absence of `asChild` / Radix `Slot`** — not a dependency; don't request one speculatively.
- **Tailwind utilities mixed with semantic classes and CSS-variable tokens** — that is the
  documented three-layer styling system, not drift.
- **Inline `style={{}}` for genuinely computed values** — allowed (498 sites). The exception is
  the chat feature, whose in-file house rule folds styles into `.rlc-*` classes in `chat.css`.
- **`useEffect` count** on its own. Effects synchronising with workers, storage, the URL, or
  analytics are correct usage.

## 5. Wrapping up

Close with: what you checked, the headline risk (or that there isn't one), and anything you
could not verify from source. Browser-only behaviour — focus order, screen-reader output,
contrast in situ — cannot be confirmed by reading a diff; say so and, if it matters, point at
the `ui-look-and-feel` screenshot recipe or ask for a manual pass.
