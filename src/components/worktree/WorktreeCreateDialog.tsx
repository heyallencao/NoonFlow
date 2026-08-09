'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { isImeComposingEvent } from '@/lib/ime';
import type { Worktree } from '@/types';

interface WorktreeCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspacePath: string;
  currentCount: number;
  maxCount: number;
  onCreated: (worktree: Worktree) => void;
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
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          branches?: string[];
          current?: string;
          error?: string;
          code?: string;
        } | null;
        if (!response.ok) {
          throw new Error(
            payload?.code === 'NOT_A_GIT_REPOSITORY'
              ? t('workspacePanel.worktreeGitOnly')
              : payload?.error || t('workspacePanel.loadBranchesFailed'),
          );
        }
        if (cancelled) return;
        const nextBranches = payload?.branches || [];
        const nextCurrent = payload?.current || '';
        setBranches(nextBranches);
        setCurrentBranch(nextCurrent);
        setBaseBranch(nextCurrent || nextBranches[0] || '');
      })
      .catch((caught) => {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : t('workspacePanel.loadBranchesFailed');
        setIsGitWorkspace(message !== t('workspacePanel.worktreeGitOnly'));
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoadingBranches(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, workspacePath, t]);

  const handleCreate = useCallback(async () => {
    const branch = branchName.trim();
    if (!branch) {
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
      const response = await fetch('/api/worktrees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_path: workspacePath,
          branch,
          base_branch: baseBranch || undefined,
        }),
      });
      const payload = await response.json().catch(() => null) as { worktree?: Worktree; error?: string } | null;
      if (!response.ok || !payload?.worktree) {
        throw new Error(payload?.error || t('workspacePanel.createWorktreeFailed'));
      }
      onCreated(payload.worktree);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('workspacePanel.createWorktreeFailed'));
    } finally {
      setCreating(false);
    }
  }, [baseBranch, branchName, isGitWorkspace, onCreated, onOpenChange, t, workspacePath]);

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
          <div className="space-y-2">
            <label className="block text-[12px] font-medium text-sidebar-foreground/80">
              {t('workspacePanel.branchName')}
            </label>
            <input
              type="text"
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              placeholder="feature/my-feature"
              className="w-full rounded-lg border border-border-default bg-bg-primary px-3.5 py-2.5 text-[13px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40 transition-colors focus:border-sidebar-foreground/30"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isImeComposingEvent(event) && !creating) {
                  void handleCreate();
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-[12px] font-medium text-sidebar-foreground/80">
              {t('workspacePanel.baseBranch')}
            </label>
            <select
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
              className="min-h-[42px] w-full appearance-none rounded-lg border border-border-default bg-bg-primary px-3.5 py-2.5 text-[13px] text-sidebar-foreground outline-none transition-colors focus:border-sidebar-foreground/30"
              disabled={loadingBranches || !isGitWorkspace}
            >
              {branches.length === 0 ? (
                <option value="">
                  {loadingBranches ? t('workspacePanel.loadingBranches') : t('workspacePanel.useCurrentHead')}
                </option>
              ) : null}
              {branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}{branch === currentBranch ? ` (${t('workspacePanel.currentBranch')})` : ''}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
              <p className="break-all text-[11px] leading-relaxed text-red-400/90">{error}</p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={creating}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={creating || loadingBranches || !branchName.trim() || currentCount >= maxCount || !isGitWorkspace}
            data-testid="create-worktree-submit"
          >
            {creating ? t('workspacePanel.creatingWorktree') : t('workspacePanel.createWorktree')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
