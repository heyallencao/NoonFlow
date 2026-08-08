'use client';

export interface DiffLine {
  type: 'add' | 'remove';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

interface DiffOp {
  type: 'equal' | 'add' | 'remove';
  content: string;
}

const MAX_DIFF_MATRIX_CELLS = 200_000;

function splitLines(content: string): string[] {
  if (!content) {
    return [];
  }
  return content.split('\n');
}

function buildFallbackOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  for (const line of oldLines) {
    ops.push({ type: 'remove', content: line });
  }
  for (const line of newLines) {
    ops.push({ type: 'add', content: line });
  }
  return ops;
}

function buildDiffOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const oldLen = oldLines.length;
  const newLen = newLines.length;

  if (oldLen === 0) {
    return newLines.map((line) => ({ type: 'add' as const, content: line }));
  }

  if (newLen === 0) {
    return oldLines.map((line) => ({ type: 'remove' as const, content: line }));
  }

  if (oldLen * newLen > MAX_DIFF_MATRIX_CELLS) {
    return buildFallbackOps(oldLines, newLines);
  }

  const dp: number[][] = Array.from({ length: oldLen + 1 }, () => Array<number>(newLen + 1).fill(0));

  for (let i = oldLen - 1; i >= 0; i -= 1) {
    for (let j = newLen - 1; j >= 0; j -= 1) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < oldLen && j < newLen) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'equal', content: oldLines[i] });
      i += 1;
      j += 1;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', content: oldLines[i] });
      i += 1;
    } else {
      ops.push({ type: 'add', content: newLines[j] });
      j += 1;
    }
  }

  while (i < oldLen) {
    ops.push({ type: 'remove', content: oldLines[i] });
    i += 1;
  }

  while (j < newLen) {
    ops.push({ type: 'add', content: newLines[j] });
    j += 1;
  }

  return ops;
}

export function buildDiffHunks(oldContent: string, newContent: string): { hunks: DiffHunk[]; stats: DiffStats } {
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  const ops = buildDiffOps(oldLines, newLines);

  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLineNumber = 1;
  let newLineNumber = 1;
  let additions = 0;
  let deletions = 0;

  for (const op of ops) {
    if (op.type === 'equal') {
      if (currentHunk && currentHunk.lines.length > 0) {
        hunks.push(currentHunk);
        currentHunk = null;
      }
      oldLineNumber += 1;
      newLineNumber += 1;
      continue;
    }

    if (!currentHunk) {
      currentHunk = {
        oldStart: oldLineNumber,
        newStart: newLineNumber,
        lines: [],
      };
    }

    if (op.type === 'remove') {
      currentHunk.lines.push({
        type: 'remove',
        content: op.content,
        oldLineNumber,
      });
      deletions += 1;
      oldLineNumber += 1;
      continue;
    }

    currentHunk.lines.push({
      type: 'add',
      content: op.content,
      newLineNumber,
    });
    additions += 1;
    newLineNumber += 1;
  }

  if (currentHunk && currentHunk.lines.length > 0) {
    hunks.push(currentHunk);
  }

  return {
    hunks,
    stats: {
      additions,
      deletions,
    },
  };
}
