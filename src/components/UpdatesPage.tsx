import { useDocumentTitle } from "../hooks/useDocumentTitle";
import notesRaw from "../../patch-notes.md?raw";
import { parsePatchNotes } from "@/lib/patchNotes";
import { PatchNoteGroups } from "./PatchNotes";

// The homepage shows only the 10 most recent bullets; this page is the full
// history — every date group in patch-notes.md, uncapped.
const groups = parsePatchNotes(notesRaw, Infinity);

export function UpdatesPage() {
  useDocumentTitle("Updates: Sky Atlas by Redline");
  return (
    <main className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-semibold text-tan mb-2">Updates</h1>
        <p className="text-sm text-tan-3 mb-8">
          Every improvement shipped to Sky Atlas by Redline, newest first.
        </p>
        <PatchNoteGroups groups={groups} />
      </div>
    </main>
  );
}
