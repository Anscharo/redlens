import { AtlasMarkdown, balanceFences } from "./markdown";
import { ParagraphChecks } from "./ParagraphChecks";
import { ReasoningBlock } from "./ReasoningBlock";
import type { StageSlotContent } from "./stageSlotContent";
import { SupersededAnswer } from "./SupersededAnswer";
import { TraceRowView } from "./TraceRow";
import { VerifyFindings } from "./VerifyFindings";

type OnAtlas = (uuid: string) => void;

export interface StageSlotProps {
  /** What this stage row discloses — pick it with `stageSlotContent(msg, entry)`. */
  content: StageSlotContent;
  /** Opens an atlas document behind a citation link inside the slot. */
  onAtlas: OnAtlas;
}

interface SynthesisSlotProps {
  content: Extract<StageSlotContent, { kind: "synthesis" }>;
  onAtlas: OnAtlas;
}

interface ChecksSlotProps {
  content: Extract<StageSlotContent, { kind: "checks" }>;
  onAtlas: OnAtlas;
}

// What one synthesizing pass produced: the thinking that opened it, whatever
// drafts it set aside, and the draft still streaming under the last pass.
function SynthesisSlot({ content, onAtlas }: SynthesisSlotProps) {
  return (
    <>
      {content.reasoning && <ReasoningBlock text={content.reasoning} />}
      {content.drafts.length > 0 && <SupersededAnswer drafts={content.drafts} onAtlas={onAtlas} />}
      {content.draft != null && (
        <div className="rlc-stage-draft">
          <AtlasMarkdown content={balanceFences(content.draft)} onAtlas={onAtlas} />
        </div>
      )}
    </>
  );
}

function ChecksSlot({ content, onAtlas }: ChecksSlotProps) {
  return (
    <>
      {content.checks.length > 0 && <ParagraphChecks checks={content.checks} />}
      {content.findings && <VerifyFindings verify={content.findings} onAtlas={onAtlas} />}
    </>
  );
}

// The working content under one open stage row. Which content a row gets is
// decided in stageSlotContent.ts; this only renders what it was handed.
export function StageSlot({ content, onAtlas }: StageSlotProps) {
  if (content.kind === "trace") {
    return (
      <>
        {content.rows.map((row, i) => (
          <TraceRowView key={i} row={row} />
        ))}
      </>
    );
  }
  if (content.kind === "synthesis") return <SynthesisSlot content={content} onAtlas={onAtlas} />;
  return <ChecksSlot content={content} onAtlas={onAtlas} />;
}
