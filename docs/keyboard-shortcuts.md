# Keyboard & modifier-click cheat sheet

Every key press, modifier+click, and non-obvious mouse gesture in the Redline
Atlas reader. Sourced from the handlers themselves — file:line references are
given so this can be re-verified rather than trusted.

`Alt` is `Option` on macOS. `⌘` is `Ctrl` on Windows/Linux everywhere it appears.

---

## The collision table

The same modifier means different things depending on what's under the cursor.
This is the part worth memorising; the rest of the document just expands on it.

| | **Reader row** | **Reader chevron `»`** | **Reader checkbox** | **Sidebar row** | **Sidebar chevron `▸`** |
|---|---|---|---|---|---|
| plain click | select the doc — or, if already selected, toggle its body | next rung of the pendulum | select just this doc | open the doc in the reader | expand one level |
| **shift**-click | open in the comparison pane | *nothing special — acts as a plain click* | select this doc **+ every descendant** | open in the comparison pane | closed → cascade **3 levels**; open → collapse the **whole subtree** |
| **alt**-click | — | **reverse** the pendulum swing | — | — | *nothing special — acts as a plain click* |

Rows say what a click will do, and both hints track the shift key:

- **Sidebar rows** carry a hover label reading *"Open &lt;title&gt;"* — the full,
  untruncated title. With shift held it becomes *"Open &lt;title&gt; in
  Splitview"*. It appears after a ½-second hover, like the native tooltip it
  replaced.
- **Reader rows** stay quiet until shift is held, then show *"shift click to
  open split view"* on whichever row is under the cursor. Their titles are
  already fully visible, so there's nothing to say until the modifier changes
  what a click does.

Both stay quiet over links, buttons, the sidebar chevron, and the selection
checkbox — places where a click means something else. The split pane itself
never shows the hint; it's already the split view.

Two traps live in that table:

- **Shift on the reader chevron does nothing.** It is deliberately inert. The
  chevron is a `<button>`, and the row's click handler bails on
  `closest('a, button, [role="button"]')` (`CollapsibleNode.tsx:282`), so shift
  there can't leak into the row's split-pane navigation either. Reversing the
  reader swing is **alt**, not shift.
- **Shift on the sidebar chevron reads the row's current state.** On a closed
  row it cascades three levels open; on an already-open row it does the mirror
  image and folds the row plus every descendant in one step. Alt used to be a
  Finder-style expand-everything; it was removed, and alt now behaves as a plain
  click (`TreeSidebar.tsx`, `toggleExpand`).

---

## Reader (`/atlas`)

### The pendulum chevron `»`

Each node's chevron discloses one level of immediate children at a time. Three
rungs, and the swing direction is remembered:

| Rung | Chevron | Shows |
|---|---|---|
| 0 | `^` up (−90°) | children hidden |
| 1 | `>` right (0°) | children's titles |
| 2 | `v` down (+90°) | children's titles **and** bodies (plus the clicked doc's own body) |

- **Click** — `hidden → titles → bodies → titles → hidden → …`. The fourth
  click hides rather than re-opening; that's the direction memory.
  (`subtreeState.ts` `nextRung`)
- **Alt-click** — swings the other way. From the middle it goes back where it
  came from; from either end it crosses straight to the far end, so
  alt-clicking a fully-hidden branch jumps straight to bodies, and alt-clicking
  an open one hides the whole branch in one click. (`subtreeState.ts`
  `reverseRung`, wired at `CollapsibleNode.tsx:165`)
- **Hover** — the chevron leans 45° toward wherever the *next* click will land.
  Hold alt while hovering and it leans toward the alt target instead, so the
  preview never lies. (`useAltKeyAttr.ts` mirrors the key onto
  `<html data-alt>`; the rotation itself is CSS at `index.css:709`.)
- Collapsing preserves what was underneath — re-opening a branch returns it to
  the shape you left it in.

### Rows

| Gesture | Effect |
|---|---|
| Click a row | Select it. If it's already selected, clicking the **title bar** toggles its body; clicking the body does nothing. |
| **Shift**-click anywhere on a row | Open that doc in the comparison pane (`?split=<uuid>`). Same as the "Open comparison pane" button. |
| Drag-select text | Suppressed — a click that moved more than a few pixels since mousedown never toggles or navigates. (`CollapsibleNode.tsx`, `DRAG_THRESHOLD_PX`) |
| **Enter** / **Space** on a focused row | Same as a plain click: select, or toggle the body if already selected. Rows are `tabIndex={0}`, so Tab reaches them. |

### Selection checkboxes

| Gesture | Effect |
|---|---|
| Click | Toggle just that doc. |
| **Shift**-click | Toggle that doc **and everything beneath it**. Works on reader rows (`NodeSelectBox.tsx`) and on Related-node cards (`RelatedSelectBox.tsx`). Search-result checkboxes have no subtree variant — a flat list has no subtree. |

---

## Tree sidebar

The sidebar container is `tabIndex={0}` (`TreeSidebar.tsx:431`) and the rows are
not focusable, so **clicking anywhere in the sidebar focuses the container** and
arrow keys start working. You can also Tab to it. (The chevron tooltip already
advertises this: *"navigate sidebar with keyboard arrow keys"*.)

| Key | Effect |
|---|---|
| **↓** / **↑** | Move the focus ring one row. With nothing focused yet, it starts from the selected row. |
| **→** | Expand the focused row (no-op if already expanded or childless). |
| **←** | Collapse the focused row. |
| **Enter** | Open the focused row in the reader and clear the focus ring. |

| Click gesture | Effect |
|---|---|
| Click a doc number or title | Open it in the reader. **Does not** expand the row. |
| **Shift**-click a row | Open it in the comparison pane. |
| Click the chevron | Expand/collapse one level. |
| **Shift**-click a **closed** chevron | Staggered cascade down 3 levels, one level per 180 ms — the same unfold animation preview mode uses to reveal changed docs. |
| **Shift**-click an **open** chevron | Collapse the row and every descendant beneath it, instantly (nothing to read on the way down, and a staggered collapse would move the row you're aiming at). |

Both shift gestures are skipped in selected-only view, where they fall back to a
plain one-level toggle: those rows are filtered to selected docs, so walking the
full tree would touch nodes that render nothing there.

---

## Search

The recent-searches dropdown under the search field is an ARIA combobox: focus
stays in the input the whole time and a highlight moves through the list.
(`useRecentDropdown.ts`)

| Key | Effect |
|---|---|
| **↓** / **↑** | Move the highlight. Up past the top returns focus to the input. |
| **Tab** | With nothing highlighted, steps into the dropdown and highlights the first suggestion. |
| **Enter** | Run the highlighted suggestion — or, with nothing highlighted, submit what you typed. |
| **Esc** | Close the dropdown. |
| **Backspace** / **Delete** on an already-empty field | Re-summon the dropdown after you've dismissed it. |

Hovering a suggestion writes the same highlight the keyboard uses, so the two
can never both be lit — whichever moved last wins.

**Query syntax** (not a shortcut, but easy to miss): wrapping a phrase in
`"double quotes"` requires a literal substring match, not just the words.

---

## Chat

⚠️ Gated behind the `__CHAT_ENABLED__` build flag and hidden in preview mode
(`App.tsx:467`) — these only exist in builds where chat is turned on.

| Key | Effect |
|---|---|
| **⌘K** / **Ctrl-K** | Open the chat widget (global — works on any route). |
| **Esc** | Close it. |
| **Enter** in the composer | Send. |
| **Shift+Enter** in the composer | Newline. |

---

## Modals & inline edits

| Key | Effect |
|---|---|
| **Esc** | Close — Save Collection, the `/admin/palette` color picker, and cancels an in-place collection rename. |
| **Enter** | Confirm — commits the hex field in the color picker, the collection name in Save Collection, and the rename in a collection card. |

---

## Mouse gestures with no key

Undocumented-but-real affordances that aren't discoverable from a static screenshot:

| Gesture | Where |
|---|---|
| Drag the sidebar's right edge | Resize the tree sidebar (`Drawer.tsx:110`). |
| Drag the annotations pane's edge | Resize the reader's annotation column (`AtlasAnnotations.tsx:69`). |
| Drag the comparison pane's top edge | Resize the split view vertically (`useSplitHeight.ts`). Persisted per browser. Opening a doc with no children shrinks the pane to fit it, which is a display cap only — your dragged height comes back on the next doc that has children. |
| Click any row in the Risk Rules table | Toggles the assessment reasoning. The chevron button is the equivalent keyboard/AT path; inner links stop propagation so they navigate instead. |

---

## Browser defaults that still work

`src/components/Link.tsx` intercepts clicks only when **no** modifier is held —
`ctrl`, `⌘`, `shift`, `alt`, and any non-primary mouse button all fall through
to the browser. So ⌘-click / middle-click to open a link in a new tab behaves
normally everywhere in the app, including sidebar breadcrumbs.

---

## Reduced motion

With `prefers-reduced-motion: reduce`, every gesture above still works and lands
in exactly the same state. What changes is only the animation: the reader
chevron's rotation and hover lean, row entrance and exit animations, the tree
row pulse (`index.css:581`, `index.css:719`) and the scroll glide
(`animatedScroll.ts:102`) all snap instead of easing.

One exception worth knowing: the sidebar's **shift-click cascade is still
staggered** under reduced motion. Its 180 ms-per-level rhythm is a `setTimeout`
chain in `TreeSidebar.tsx`, not a CSS animation, so the media query doesn't
reach it — the levels still arrive one at a time.
