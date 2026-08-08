'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { HugeiconsIcon } from "@hugeicons/react";
import { FileEditIcon, ArrowRight01Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { usePanel } from '@/hooks/usePanel';
import { cn } from '@/lib/utils';
import { FileDiffView } from './file-diff-view';
import { publishOpenFilePreview } from '@/lib/events/app-event-bus';

interface FileChangeOperation {
  toolName: string;
  toolInput: unknown;
}

interface FileChange {
  filePath: string;
  toolName: string;
  toolInput: unknown;
  additions: number;
  deletions: number;
  operations: FileChangeOperation[];
  beforeContent: string;
  afterContent: string;
  diffNote?: string;
}

interface FileChangesSummaryProps {
  messageId: string;
  changes: FileChange[];
}

const revertedMessageIds = new Set<string>();

function extractFilename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/**
 * File Changes Summary Component
 * Displays a collapsible summary of all file modifications after AI completes its response
 */
export function FileChangesSummary({ messageId, changes }: FileChangesSummaryProps) {
  const { workingDirectory } = usePanel();
  const [expanded, setExpanded] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [isReverting, setIsReverting] = useState(false);
  const [revertSuccess, setRevertSuccess] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);
  const [confirmingRevert, setConfirmingRevert] = useState(false);

  useEffect(() => {
    if (revertedMessageIds.has(messageId)) {
      setRevertSuccess(true);
    }
  }, [messageId]);

  if (changes.length === 0) return null;

  const totalAdditions = changes.reduce((sum, c) => sum + c.additions, 0);
  const totalDeletions = changes.reduce((sum, c) => sum + c.deletions, 0);
  const missingLineStatsFileCount = changes.filter((c) => c.additions === 0 && c.deletions === 0).length;

  const toggleFileExpansion = (filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const handleRevertAll = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent expanding/collapsing when clicking revert

    if (!confirmingRevert) {
      setConfirmingRevert(true);
      setRevertError(null);
      return;
    }

    setIsReverting(true);
    setRevertError(null);
    setConfirmingRevert(false);

    try {
      const baseDir = workingDirectory || undefined;

      console.log('Reverting changes:', { changes, baseDir });

      // Call API to revert changes
      const response = await fetch('/api/revert-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: changes.map(c => ({
            filePath: c.filePath,
            operations: c.operations,
          })),
          baseDir,
        }),
      });

      const data = await response.json();
      console.log('Revert response:', data);

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to revert changes');
      }

      // Check if any files failed
      if (data.results) {
        const failed = data.results.filter((r: { success: boolean }) => !r.success);
        if (failed.length > 0) {
          console.error('Some files failed to revert:', failed);
          throw new Error(`${failed.length} 个文件撤销失败`);
        }
      }

      revertedMessageIds.add(messageId);

      setRevertSuccess(true);
      setTimeout(() => {
        // Reload the page to reflect changes
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error('Revert error:', error);
      setRevertError(error instanceof Error ? error.message : 'Failed to revert changes');
    } finally {
      setIsReverting(false);
    }
  };

  return (
    <div className="w-[min(100%,48rem)] my-2">
      {/* Header */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border/50 hover:bg-muted/50 transition-colors"
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200",
              expanded && "rotate-90"
            )}
          />

          <HugeiconsIcon icon={FileEditIcon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />

          <span className="text-xs font-medium text-foreground/80">
            {changes.length} 个文件已更改
          </span>
          {missingLineStatsFileCount > 0 && (
            <span className="text-[10px] text-muted-foreground/70">
              {missingLineStatsFileCount} 个未提供行统计
            </span>
          )}

          <span className="text-xs text-green-600 dark:text-green-400">
            +{totalAdditions}
          </span>

          <span className="text-xs text-red-600 dark:text-red-400">
            -{totalDeletions}
          </span>

          <span className="ml-auto text-[10px] text-muted-foreground/50 mr-20">
            点击查看详情
          </span>
        </button>

        {/* Revert button */}
        <button
          type="button"
          onClick={handleRevertAll}
          onBlur={() => {
            if (!isReverting) {
              setConfirmingRevert(false);
            }
          }}
          disabled={isReverting || revertSuccess}
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            revertSuccess
              ? "bg-green-500/10 text-green-600 dark:text-green-400 cursor-default"
              : isReverting
              ? "bg-muted/50 text-muted-foreground/50 cursor-wait"
              : confirmingRevert
              ? "bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400"
              : "bg-background border border-border/50 text-foreground/70 hover:bg-muted/50 hover:text-foreground"
          )}
          title={confirmingRevert ? '再次点击确认撤销' : '撤销所有文件修改'}
        >
          {revertSuccess ? (
            <>
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span>已撤销</span>
            </>
          ) : isReverting ? (
            <>
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>撤销中...</span>
            </>
          ) : confirmingRevert ? (
            <>
              <HugeiconsIcon icon={ArrowLeft01Icon} className="h-3.5 w-3.5" />
              <span>确认撤销</span>
            </>
          ) : (
            <>
              <HugeiconsIcon icon={ArrowLeft01Icon} className="h-3.5 w-3.5" />
              <span>撤销</span>
            </>
          )}
        </button>

        {/* Error message */}
        {revertError && (
          <div className="absolute top-full left-0 right-0 mt-1 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
            {revertError}
          </div>
        )}

        {confirmingRevert && !revertError && (
          <div className="absolute top-full left-0 right-0 mt-1 px-3 py-2 rounded-md bg-muted border border-border/50 text-xs text-muted-foreground">
            再点击一次“确认撤销”以回滚这条回答里的全部文件修改。
          </div>
        )}
      </div>

      {/* Expanded file list */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden', transformOrigin: 'top' }}
          >
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
            >
              <div className="ml-1.5 mt-2 border-l-2 border-border/30 pl-3 space-y-2">
                {changes.map((change, i) => {
                  const isExpanded = expandedFiles.has(change.filePath);
                  return (
                    <div key={i}>
                      <div className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs rounded-md transition-colors bg-background border border-border hover:bg-white/[0.04]">
                        <button
                          type="button"
                          onClick={() => toggleFileExpansion(change.filePath)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <HugeiconsIcon
                            icon={ArrowRight01Icon}
                            className={cn(
                              "h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform duration-200",
                              isExpanded && "rotate-90"
                            )}
                          />

                          <span className="font-mono text-foreground/80 truncate">
                            {extractFilename(change.filePath)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            publishOpenFilePreview({ path: change.filePath });
                          }}
                          className="shrink-0 rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          title={change.filePath}
                        >
                          打开
                        </button>

                        {change.operations.length > 1 && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            本条回复内 {change.operations.length} 次修改
                          </span>
                        )}

                        {change.additions > 0 || change.deletions > 0 ? (
                          <>
                            <span className="text-green-600 dark:text-green-400 text-[11px]">
                              +{change.additions}
                            </span>

                            <span className="text-red-600 dark:text-red-400 text-[11px]">
                              -{change.deletions}
                            </span>
                          </>
                        ) : (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            未提供行统计
                          </span>
                        )}
                      </div>

                      {/* File diff */}
                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            style={{ overflow: 'hidden' }}
                          >
                            <div className="mt-2 ml-4">
                              <FileDiffView
                                filePath={change.filePath}
                                toolName={change.toolName}
                                toolInput={change.toolInput}
                                operationCount={change.operations.length}
                                beforeContent={change.beforeContent}
                                afterContent={change.afterContent}
                                note={change.diffNote}
                                emptyStateHint="暂无可展示差异。可能是变更已被后续步骤覆盖，或当前工作区状态已与该步骤不一致。"
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
                <div className="mt-2 rounded-md border border-border/60 bg-muted/25 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  汇总：共修改 {changes.length} 个文件
                  <span className="mx-1 text-muted-foreground/40">|</span>
                  <span className="text-green-600 dark:text-green-400">+{totalAdditions}</span>
                  <span className="mx-1 text-muted-foreground/40">/</span>
                  <span className="text-red-600 dark:text-red-400">-{totalDeletions}</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
