'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePanel } from './usePanel';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { normalizeWorkspacePath } from '@/lib/workspace-utils';

interface FocusRepoOptions {
  repoPath: string;
  workspacePath?: string | null;
}

export function useCodebaseNavigation() {
  const { setWorkingDirectory } = usePanel();
  const workspacePaths = useWorkspaceStore((state) => state.workspacePaths);
  const rememberWorkspace = useWorkspaceStore((state) => state.rememberWorkspace);
  const setLastWorkspace = useWorkspaceStore((state) => state.setLastWorkspace);
  const router = useRouter();

  const openInFinder = useCallback(async (path: string) => {
    if (typeof window !== 'undefined' && window.electronAPI?.shell?.openPath) {
      try {
        await window.electronAPI.shell.openPath(path);
      } catch (err) {
        console.error('Failed to open in Finder:', err);
      }
    }
  }, []);

  const focusRepo = useCallback(({ repoPath, workspacePath }: FocusRepoOptions) => {
    const normalizedRepoPath = normalizeWorkspacePath(repoPath);
    if (!normalizedRepoPath) return;

    const normalizedWorkspacePath =
      normalizeWorkspacePath(workspacePath || '') ||
      workspacePaths
        .slice()
        .sort((left, right) => right.length - left.length)
        .find((candidate) => {
          const normalizedCandidate = normalizeWorkspacePath(candidate);
          if (!normalizedCandidate) return false;
          return (
            normalizedRepoPath === normalizedCandidate ||
            normalizedRepoPath.startsWith(`${normalizedCandidate}/`)
          );
        }) ||
      null;

    if (normalizedWorkspacePath) {
      rememberWorkspace(normalizedWorkspacePath);
      setLastWorkspace(normalizedWorkspacePath);
    }

    setWorkingDirectory(normalizedRepoPath);

    const params = new URLSearchParams({ repo: normalizedRepoPath });
    if (normalizedWorkspacePath) {
      params.set('workspace', normalizedWorkspacePath);
    }

    router.push(`/work-graph?${params.toString()}`);
  }, [rememberWorkspace, router, setLastWorkspace, setWorkingDirectory, workspacePaths]);

  return { openInFinder, focusRepo };
}
