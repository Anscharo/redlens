import type { FlowLayout } from "../lib/mscFlowLayout";
import { tweenFlowLayout } from "../lib/mscFlowTween";
import { useTweened } from "./useTweened";

/** The flow chart's month-to-month transition: its layout, tweened (see
 *  useTweened; mscFlowTween.ts for what moves). */
export function useTweenedFlow(target: FlowLayout): FlowLayout {
  return useTweened(target, tweenFlowLayout);
}
