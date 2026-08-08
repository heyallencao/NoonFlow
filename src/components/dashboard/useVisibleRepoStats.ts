'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toLocalDateKey } from '@/lib/date-key';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface WorkGraphResponse {
  commitActivity?: Array<{ date: string; count: number }>;
  allRepos?: Array<{ path: string }>;
}

interface VisibleRepoStats {
  commitsToday: number;
  repoCount: number;
}

async function fetchVisibleRepoStats(visibleWorkspaces: string[]): Promise<VisibleRepoStats> {
  if (visibleWorkspaces.length === 0) {
    return {
      commitsToday: 0,
      repoCount: 0,
    };
  }

  const today = toLocalDateKey(new Date());
  const responses = await Promise.all(
    visibleWorkspaces.map(async (workspace) => {
      const res = await fetch(`/api/work-graph?workspace=${encodeURIComponent(workspace)}&days=1`);
      if (!res.ok) {
        throw new Error('Failed to fetch visible repo stats');
      }
      return res.json() as Promise<WorkGraphResponse>;
    }),
  );

  return responses.reduce<VisibleRepoStats>((acc, result) => {
    const todayCommitCount = result.commitActivity?.find((d) => d.date === today)?.count ?? 0;
    return {
      commitsToday: acc.commitsToday + todayCommitCount,
      repoCount: acc.repoCount + (result.allRepos?.length ?? 0),
    };
  }, { commitsToday: 0, repoCount: 0 });
}

export function useVisibleRepoStats() {
  const workspacePaths = useWorkspaceStore((s) => s.workspacePaths);
  const hiddenWorkspaces = useWorkspaceStore((s) => s.hiddenWorkspaces);

  const visibleWorkspaces = useMemo(
    () => workspacePaths.filter((workspace) => !hiddenWorkspaces.includes(workspace)),
    [workspacePaths, hiddenWorkspaces],
  );

  const query = useQuery({
    queryKey: ['overview-visible-repo-stats', visibleWorkspaces],
    queryFn: () => fetchVisibleRepoStats(visibleWorkspaces),
    enabled: visibleWorkspaces.length > 0,
    staleTime: 45_000,
  });

  return {
    commitsToday: query.data?.commitsToday ?? 0,
    repoCount: query.data?.repoCount ?? visibleWorkspaces.length,
    isLoading: query.isLoading,
  };
}
