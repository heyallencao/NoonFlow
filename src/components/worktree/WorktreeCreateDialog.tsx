'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { isImeComposingEvent } from '@/lib/ime';

interface WorktreeCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspacePath: string;
  currentCount: number;
  maxCount: number;
  onCreated: () => void;
}

export function WorktreeCreateDialog({
  open,
  onOpenChange,
  workspacePath,
  currentCount,
  maxCount,
  onCreated,
}: WorktreeCreateDialogProps) {
  const { t } = useTranslation();
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [creating, setCreating] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [isGitWorkspace, setIsGitWorkspace] = useState(true);
  const [error, setError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  // Fetch branches when dialog opens
  useEffect(() => {
    if (!open || !workspacePath) return;
    setBranchName('');
    setBaseBranch('');
    setBranches([]);
    setCurrentBranch('');
    setIsGitWorkspace(true);
    setError('');
    setLoadingBranches(true);

    let cancelled = false;

    void fetch(`/api/worktrees/branches?path=${encodeURIComponent(workspacePath)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null) as {
          branches?: string[];
          current?: string;
          error?: string;
          code?: string;
        } | null;

        if (!res.ok) {
          throw new Error(data?.code === 'NOT_A_GIT_REPOSITORY'
            ? t('workspacePanel.worktreeGitOnly')
            : data?.error || t('workspacePanel.loadBranchesFailed'));
        }

        if (cancelled) return;
        setIsGitWorkspace(true);
        setBranches(data?.branches || []);
        setCurrentBranch(data?.current || '');
        setBaseBranch(data?.current || '');
      })
      .catch((err) => {
        if (cancelled) return;
        setBranches([]);
        setCurrentBranch('');
        setBaseBranch('');
        if (err instanceof Error && err.message === t('workspacePanel.worktreeGitOnly')) {
          setIsGitWorkspace(false);
        }
        setError(err instanceof Error ? err.message : t('workspacePanel.loadBranchesFailed'));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingBranches(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, workspacePath, t]);

  const handleCreate = useCallback(async () => {
    if (!branchName.trim()) {
      setError(t('workspacePanel.branchNameRequired'));
      return;
    }

    if (!isGitWorkspace) {
      setError(t('workspacePanel.worktreeGitOnly'));
      return;
    }

    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/worktrees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_path: workspacePath,
          branch: branchName.trim(),
          base_branch: baseBranch || undefined,
          name: branchName.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || t('workspacePanel.createWorktreeFailed'));
      }

      // Show success animation
      setShowSuccess(true);
      await new Promise(resolve => setTimeout(resolve, 800));

      onOpenChange(false);
      onCreated();

      // Reset success state after dialog closes
      setTimeout(() => setShowSuccess(false), 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workspacePanel.createWorktreeFailed'));
    } finally {
      setCreating(false);
    }
  }, [branchName, baseBranch, isGitWorkspace, workspacePath, onOpenChange, onCreated, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border-default bg-bg-secondary text-sidebar-foreground sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold">{t('workspacePanel.newWorktree')}</DialogTitle>
          <DialogDescription className="text-[12px] text-sidebar-foreground/60">
            {t('workspacePanel.worktreeLimitHint', { current: currentCount, max: maxCount })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {showSuccess && (
            <div className="flex items-center justify-center py-6">
              <div
                className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10"
                style={{
                  animation: 'successPulse 0.6s cubic-bezier(0.25, 1, 0.5, 1)',
                }}
              >
                <svg
                  className="h-10 w-10 text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  style={{
                    animation: 'checkDraw 0.5s cubic-bezier(0.25, 1, 0.5, 1) 0.1s both',
                  }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          )}

          {!showSuccess && (
            <>
              <div className="space-y-2">
                <label className="block text-[12px] font-medium text-sidebar-foreground/80">
                  {t('workspacePanel.branchName')}
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="feature/my-feature"
                  className="w-full rounded-lg border border-border-default bg-bg-primary px-3.5 py-2.5 text-[13px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40 transition-colors focus:border-sidebar-foreground/30"
                  autoFocus
                  onKeyDown={(e) => {
                    // IME composing 状态下按回车只用于选词，不触发发送
                    if (e.key === 'Enter' && !isImeComposingEvent(e) && !creating) {
                      void handleCreate();
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[12px] font-medium text-sidebar-foreground/80">
                  {t('workspacePanel.baseBranch')}
                </label>
                <div className="relative">
                  <select
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-border-default bg-bg-primary px-3.5 py-2.5 pr-10 text-[13px] text-sidebar-foreground outline-none transition-colors focus:border-sidebar-foreground/30"
                    style={{ minHeight: '42px' }}
                  >
                    {branches.length === 0 && (
                      <option value="">
                        {loadingBranches ? t('workspacePanel.loadingBranches') : t('workspacePanel.useCurrentHead')}
                      </option>
                    )}
                    {branches.map((b) => (
                      <option key={b} value={b}>
                        {b}{b === currentBranch ? ` (${t('workspacePanel.currentBranch')})` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                    <svg className="h-4 w-4 text-sidebar-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
                  <p className="break-all text-[11px] leading-relaxed text-red-400/90">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        <style jsx>{`
          @keyframes successPulse {
            0% {
              transform: scale(0.8);
              opacity: 0;
            }
            50% {
              transform: scale(1.1);
            }
            100% {
              transform: scale(1);
              opacity: 1;
            }
          }

          @keyframes checkDraw {
            0% {
              stroke-dasharray: 0 100;
              opacity: 0;
            }
            100% {
              stroke-dasharray: 100 100;
              opacity: 1;
            }
          }
        `}</style>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={creating}
            className="text-[12px]"
          >
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={
              creating
              || !branchName.trim()
              || currentCount >= maxCount
              || !isGitWorkspace
            }
            className="text-[12px]"
          >
            {creating ? t('workspacePanel.creatingWorktree') : t('workspacePanel.createWorktree')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
