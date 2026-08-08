'use client';

import { useState, useEffect } from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";
import { buildDiffHunks, type DiffHunk } from './file-diff-utils';

interface FileDiffViewProps {
  filePath: string;
  toolName: string;
  toolInput: unknown;
  operationCount?: number;
  beforeContent?: string;
  afterContent?: string;
  note?: string;
  emptyStateHint?: string;
}

/**
 * Simple diff viewer for file changes
 * Shows before/after comparison for Write/Edit operations
 */
export function FileDiffView({
  filePath,
  toolName,
  toolInput,
  operationCount = 1,
  beforeContent,
  afterContent,
  note,
  emptyStateHint,
}: FileDiffViewProps) {
  const [diffHunks, setDiffHunks] = useState<DiffHunk[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ additions: number; deletions: number } | null>(null);

  useEffect(() => {
    async function loadDiff() {
      try {
        setLoading(true);
        setError(null);

        if (beforeContent !== undefined && afterContent !== undefined) {
          const diff = buildDiffHunks(beforeContent, afterContent);
          setDiffHunks(diff.hunks);
          setStats(diff.stats);
          return;
        } else if (toolName === 'Edit') {
          // For Edit tool, we can extract old_string and new_string
          const input = toolInput as Record<string, unknown>;
          const oldString = String(input.old_string || '');
          const newString = String(input.new_string || '');
          const diff = buildDiffHunks(oldString, newString);
          setDiffHunks(diff.hunks);
          setStats(diff.stats);
        } else if (toolName === 'Write') {
          // For Write tool, show the new content (first 50 lines)
          const input = toolInput as Record<string, unknown>;
          const content = String(input.content || '');
          const diff = buildDiffHunks('', content);
          setDiffHunks(diff.hunks);
          setStats(diff.stats);
        } else {
          setDiffHunks([]);
          setStats({ additions: 0, deletions: 0 });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load diff');
      } finally {
        setLoading(false);
      }
    }

    loadDiff();
  }, [afterContent, beforeContent, filePath, toolName, toolInput]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
        <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin" />
        <span>Loading diff...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (!diffHunks || diffHunks.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        {emptyStateHint || 'No changes to display'}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-background overflow-hidden">
      {/* Header with file path and stats */}
      <div className="bg-muted/50 px-3 py-1.5 flex items-center justify-between text-xs border-b border-border">
        <span className="font-mono text-muted-foreground truncate">{filePath}</span>
        <div className="ml-2 flex shrink-0 items-center gap-2">
          {operationCount > 1 && (
            <span className="text-[10px] text-muted-foreground/60">
              当前展示本条回复的净变化
            </span>
          )}
          {note && (
            <span className="text-[10px] text-muted-foreground/60">
              {note}
            </span>
          )}
          {stats && (
            <span className="text-muted-foreground/70">
              <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
              {' '}
              <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
            </span>
          )}
        </div>
      </div>

      {/* Diff content */}
      <div className="font-mono text-xs overflow-x-auto max-h-[500px] overflow-y-auto">
        {diffHunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx}>
            {hunk.lines.map((line, i) => (
              <div
                key={`${line.type}-${i}`}
                className={line.type === 'remove' ? 'flex bg-red-500/10' : 'flex bg-green-500/10'}
              >
                <span className={line.type === 'remove'
                  ? 'inline-block w-12 shrink-0 text-right pr-3 text-muted-foreground/50 select-none border-r border-red-500/20'
                  : 'inline-block w-12 shrink-0 text-right pr-3 text-muted-foreground/50 select-none border-r border-green-500/20'}
                >
                  {line.type === 'remove' ? line.oldLineNumber : line.newLineNumber}
                </span>
                <span className={line.type === 'remove'
                  ? 'inline-block w-6 shrink-0 text-center select-none text-red-600 dark:text-red-400'
                  : 'inline-block w-6 shrink-0 text-center select-none text-green-600 dark:text-green-400'}
                >
                  {line.type === 'remove' ? '-' : '+'}
                </span>
                <span className={line.type === 'remove'
                  ? 'flex-1 pr-3 whitespace-pre text-red-600 dark:text-red-400'
                  : 'flex-1 pr-3 whitespace-pre text-green-600 dark:text-green-400'}
                >
                  {line.content}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
