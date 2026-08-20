import type { PageContextView } from "./pageContext";

// Collapsed launcher pill: ember dot + context-aware label + ⌘K hint.
export function ChatLauncher({ onOpen, context }: { onOpen: () => void; context: PageContextView }) {
  return (
    <button className="rlc-launcher" onClick={onOpen} aria-label="Open the Atlas agent">
      <span className="rlc-ember" aria-hidden="true" />
      <span>{context.short}</span>
      <kbd>⌘K</kbd>
    </button>
  );
}
