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

export function depthColor(depth: number): string {
  return `var(--depth-${Math.min(Math.max(depth, 1), 17)})`;
}

export function chicletColor(depth: number): string {
  return depth === 0 ? "var(--tan-2)" : `var(--depth-${Math.min(Math.max(depth, 1), 17)})`;
}
