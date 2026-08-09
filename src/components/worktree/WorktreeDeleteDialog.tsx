'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import type { Worktree, WorktreeDeleteStatus } from '@/types';

interface WorktreeDeleteDialogProps {
  worktree: Worktree | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (worktree: Worktree) => void;
}

export function WorktreeDeleteDialog({ worktree, onOpenChange, onDeleted }: WorktreeDeleteDialogProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<WorktreeDeleteStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!worktree) return;
    setStatus(null);
    setDeleteBranch(false);
    setError('');
    setChecking(true);
    let cancelled = false;

    const params = new URLSearchParams({
      workspace: worktree.workspace_path,
      worktree: worktree.worktree_path,
    });
    void fetch(`/api/worktrees?${params.toString()}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          delete_status?: WorktreeDeleteStatus;
          error?: string;
        } | null;
        if (!response.ok) throw new Error(payload?.error || t('workspacePanel.worktreeDeleteCheckFailed'));
        if (!cancelled) setStatus(payload?.delete_status || null);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t('workspacePanel.worktreeDeleteCheckFailed'));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [t, worktree]);

  const handleDelete = async () => {
    if (!worktree) return;
    setDeleting(true);
    setError('');
    try {
      const response = await fetch('/api/worktrees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_path: worktree.workspace_path,
          worktree_path: worktree.worktree_path,
          confirm: true,
          force_dirty: status?.has_changes === true,
          delete_branch: deleteBranch,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        branch_delete_error?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.error || t('workspacePanel.deleteFailed'));
      if (payload?.branch_delete_error) toast.warning(payload.branch_delete_error);
      onDeleted(worktree);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('workspacePanel.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={Boolean(worktree)} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-border-default bg-bg-secondary text-sidebar-foreground">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('workspacePanel.worktreeDeleteConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sidebar-foreground/70">
              <p>{t('workspacePanel.worktreeDeleteConfirmDesc', { name: worktree?.name || '' })}</p>
              {checking ? <p>{t('workspacePanel.worktreeDeleteCheckingChanges')}</p> : null}
              {status?.has_changes ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-red-300/90">
                  {t('workspacePanel.worktreeDeleteDirtyWarning', {
                    count: status.dirty_files_count + status.untracked_files_count,
                    dirty: status.dirty_files_count,
                    untracked: status.untracked_files_count,
                  })}
                </div>
              ) : null}
              {worktree?.branch ? (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border-subtle/50 bg-bg-tertiary/30 p-3">
                  <input
                    type="checkbox"
                    checked={deleteBranch}
                    onChange={(event) => setDeleteBranch(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span className="space-y-1">
                    <span className="block text-[12px] font-medium text-sidebar-foreground/90">
                      {t('workspacePanel.deleteBranchOption')}
                    </span>
                    <code className="block text-[11px] text-sidebar-foreground/65">{worktree.branch}</code>
                  </span>
                </label>
              ) : null}
              {deleteBranch ? <p className="text-red-300/90">{t('workspacePanel.deleteBranchWarning')}</p> : null}
              <p>{t('workspacePanel.worktreeDeleteConfirmWarning')}</p>
              {error ? <p className="break-all text-red-400">{error}</p> : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={checking || deleting}
            onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
          >
            {deleting
              ? t('workspacePanel.deleting')
              : deleteBranch
                ? t('workspacePanel.deleteWorktreeAndBranch')
                : t('workspacePanel.worktreeDeleteAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
