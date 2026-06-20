export function realDepth(doc_no: string, parentDocNo?: string): number {
  if (doc_no.startsWith("NR-")) return parentDocNo ? realDepth(parentDocNo) + 1 : 1;
  const parts = doc_no.split(".");

  const varIdx = parts.findIndex((p) => p.startsWith("var"));
  if (varIdx >= 0) return realDepth(parts.slice(0, varIdx).join(".")) + 1;

  let markerIdx = -1;
  for (let i = 1; i < parts.length - 1; i++) {
    if (
      parts[i] === "0" &&
      (parts[i + 1] === "3" || parts[i + 1] === "4" || parts[i + 1] === "6")
    ) {
      markerIdx = i;
    }
  }

  if (markerIdx >= 0) {
    const targetDepth = markerIdx - 1;
    const supportingIdx = markerIdx + 2;
    const baseDepth = targetDepth + 1;
    const after = parts.slice(supportingIdx + 1);
    let extra = 0;
    let i = 0;
    while (i < after.length) {
      if (after[i] === "1" && i + 1 < after.length) {
        extra++;
        i += 2;
      } else {
        extra++;
        i++;
      }
    }
    return baseDepth + extra;
  }

  return parts.length - 1;
}

export function segmentDepths(doc_no: string): number[] {
  if (doc_no.startsWith("NR-")) return [1];
  const parts = doc_no.split(".");
  const depths: number[] = Array.from({ length: parts.length }, () => 0);

  let curDepth = 0;
  let inTenet = false;
  let i = 0;
  while (i < parts.length) {
    if (parts[i].startsWith("var")) {
      curDepth++;
      depths[i] = curDepth;
      inTenet = false;
      i++;
      continue;
    }
    if (
      parts[i] === "0" &&
      i + 2 < parts.length &&
      (parts[i + 1] === "3" || parts[i + 1] === "4" || parts[i + 1] === "6")
    ) {
      curDepth++;
      depths[i] = curDepth;
      depths[i + 1] = curDepth;
      depths[i + 2] = curDepth;
      inTenet = parts[i + 1] === "4";
      i += 3;
      continue;
    }
    if (inTenet && parts[i] === "1" && i + 1 < parts.length) {
      curDepth++;
      depths[i] = curDepth;
      depths[i + 1] = curDepth;
      inTenet = false;
      i += 2;
      continue;
    }
    if (i === 0) {
      depths[i] = 0;
    } else {
      curDepth++;
      depths[i] = curDepth;
    }
    inTenet = false;
    i++;
  }
  return depths;
}

// Reader (document) layout for NR-X nodes: render the bare token per-character.
// The "NR-" prefix (through the dash) is neutral depth 0; the number takes the
// node's true depth colour.
export function nrChiclets(
  nrToken: string,
  depth: number,
): { parts: string[]; depths: number[] } {
  const dashAt = nrToken.indexOf("-");
  const prefixEnd = dashAt < 0 ? nrToken.length : dashAt + 1; // include the dash
  const chars = nrToken.split("");
  const depths = chars.map((_, i) => (i < prefixEnd ? 0 : depth));
  return { parts: chars, depths };
}

// Sidebar layout for NR-X nodes: pin "NR" under the parent's first segment ("A")
// and colour it like that segment, then stretch the dash so the number lands one
// column past the parent's last segment — where a real child's deeper doc_no would
// begin, aligning it with the node's siblings. The dash carries a gradient running
// through every parent colour and ending on the number's depth colour, bridging
// "NR" to the number. Returns per-chiclet `slots` (column span) and `gradients`.
export function nrSidebarChiclets(
  nrToken: string,
  parentDocNo: string | undefined,
  depth: number,
): { parts: string[]; depths: number[]; slots: number[]; gradients: (string | undefined)[] } {
  const dashAt = nrToken.indexOf("-");
  if (dashAt < 0) {
    const chars = nrToken.split("");
    return {
      parts: chars,
      depths: chars.map(() => depth),
      slots: chars.map(() => 1),
      gradients: chars.map(() => undefined),
    };
  }
  const lead = nrToken.slice(0, dashAt).split(""); // "NR" → ["N","R"]
  const num = nrToken.slice(dashAt + 1).split(""); // "12" → ["1","2"]
  const parentDepths = parentDocNo ? segmentDepths(parentDocNo) : [0];
  const leadDepth = parentDepths[0] ?? 0; // colour "NR" like the parent's "A"
  const dashSlots = Math.max(1, parentDepths.length - lead.length);
  const stops = [...parentDepths.map(chicletColor), chicletColor(depth)];
  const gradient = `linear-gradient(to right, ${stops.join(", ")})`;
  // The dash slot carries the gradient connector line but no "-" glyph in the sidebar.
  const parts = [...lead, "", ...num];
  const depths = [...lead.map(() => leadDepth), depth, ...num.map(() => depth)];
  const slots = [...lead.map(() => 1), dashSlots, ...num.map(() => 1)];
  const gradients: (string | undefined)[] = [
    ...lead.map(() => undefined),
    gradient,
    ...num.map(() => undefined),
  ];
  return { parts, depths, slots, gradients };
}

export function depthColor(depth: number): string {
  return `var(--depth-${Math.min(Math.max(depth, 1), 17)})`;
}

export function chicletColor(depth: number): string {
  return depth === 0 ? "var(--tan-2)" : `var(--depth-${Math.min(Math.max(depth, 1), 17)})`;
}
