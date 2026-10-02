export interface HistoryCommentFinding {
  path: string;
  line: number;
  text: string;
  why: string;
}

export function commentText(line: string): string | null;
export function judgeComment(text: string): { why: string }[];
export function scanDiff(diff: string): HistoryCommentFinding[];
