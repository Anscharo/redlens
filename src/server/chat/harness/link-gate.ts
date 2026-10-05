// Streaming citation gate: the post-answer LinkJudge applied to tokens, so a
// bad link is repaired before it streams. A gate failure emits the link as
// written; the post-answer pass is the safety net.
import type { Indexes } from "../../retrieval/indexes.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";
import { createLinkJudge, displayText, repairDefinitionBlock, type LinkJudge } from "../verify/citation-repair.ts";
import { createCitationGate } from "../verify/definition-block-gate.ts";

/**
 * Everything retrieved so far: `texts` is the flat list the judge reads
 * (history tool texts first, then each round's results), `results` this
 * turn's results with their tool name, for the checks that split by provenance.
 */
export interface GateEvidence {
  texts: string[];
  results: { name: string; content: string }[];
}

export interface StreamGate {
  makeGate: () => ReturnType<typeof createCitationGate>;
  /** New evidence landed — the judge is rebuilt on the next link. */
  invalidate: () => void;
}

// The judge's verdict as markdown, or null to emit the link as written.
function renderVerdict(judge: LinkJudge, ix: Indexes, title: string, target: string): string | null {
  const v = judge(title, target);
  if (v.action === "repair") return `[${displayText(title, v.to, ix)}](/atlas/${v.to})`;
  if (v.action === "strip") return title;
  // keep — but a uuid used as the link text still reads as an address to the
  // reader; show the title, same as the post-answer pass will.
  const uuid = target.match(/[0-9a-f-]{36}/i)?.[0];
  if (uuid) {
    const text = displayText(title, uuid, ix);
    if (text !== title) return `[${text}](/atlas/${uuid.toLowerCase()})`;
  }
  return null;
}

class LazyLinkGate implements StreamGate {
  private judge: LinkJudge | null = null;
  private readonly ix: Indexes;
  private readonly obs: ErrorContext | undefined;
  private readonly evidence: GateEvidence;

  constructor(ix: Indexes, obs: ErrorContext | undefined, evidence: GateEvidence) {
    this.ix = ix;
    this.obs = obs;
    this.evidence = evidence;
  }

  private currentJudge(): LinkJudge {
    return (this.judge ??= createLinkJudge(this.evidence.texts, this.ix));
  }

  private renderLink(title: string, target: string, raw: string): string {
    try {
      return renderVerdict(this.currentJudge(), this.ix, title, target) ?? raw;
    } catch (err) {
      captureError(err, this.obs, { stage: "stream_link_gate" });
      return raw;
    }
  }

  // Reference-style answers stream a definition block first; the gate buffers it
  // and repairs the whole citation table once (same judge, same evidence) before
  // releasing it, so a garbled definition never flashes as a live dead link.
  // A gate failure degrades to emitting the block unrepaired — the post-answer
  // pass is the safety net.
  private repairBlock(block: string): string {
    try {
      return repairDefinitionBlock(block, this.currentJudge()).content;
    } catch (err) {
      captureError(err, this.obs, { stage: "stream_link_gate" });
      return block;
    }
  }

  makeGate = () =>
    createCitationGate({
      render: (title, target, raw) => this.renderLink(title, target, raw),
      repairBlock: (block) => this.repairBlock(block),
    });

  invalidate = () => {
    this.judge = null;
  };
}

export function createLinkGate(ix: Indexes, obs: ErrorContext | undefined, evidence: GateEvidence): StreamGate {
  return new LazyLinkGate(ix, obs, evidence);
}
