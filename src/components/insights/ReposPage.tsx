'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface GitRepoStatus {
  repoRoot: string;
  workspacePath: string;
  name: string;
  branch: string;
  dirtyFilesCount: number;
  untrackedFilesCount: number;
  aheadCount: number;
  behindCount: number;
  lastCommitAt: string | null;
  status: 'clean' | 'dirty' | 'ahead' | 'behind' | 'diverged' | 'error';
  error?: string;
}

interface ReposData {
  repos: GitRepoStatus[];
  scannedAt: string;
  totalRepos: number;
  errors: Array<{ path: string; error: string }>;
}

export function ReposPage() {
  const { t } = useTranslation();
  const lastWorkspace = useWorkspaceStore((state) => state.lastWorkspace);
  const [data, setData] = useState<ReposData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debug: 打印工作区信息
  useEffect(() => {
    console.log('[ReposPage] lastWorkspace:', lastWorkspace);
  }, [lastWorkspace]);

  useEffect(() => {
    if (!lastWorkspace) {
      setLoading(false);
      return;
    }

    const fetchRepos = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/repos?workspace=${encodeURIComponent(lastWorkspace)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch repositories');
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchRepos();
  }, [lastWorkspace]);

  if (!lastWorkspace) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('repos.title')}</CardTitle>
            <CardDescription>
              {t('repos.noWorkspace')}
              <br />
              <span className="text-xs mt-2 block">
                Please select a workspace from the sidebar first.
              </span>
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('repos.title')}</CardTitle>
            <CardDescription className="text-destructive">{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('repos.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('repos.description')} ({data?.totalRepos || 0} {t('repos.repositories')})
        </p>
      </div>

      {data && data.repos.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('repos.noRepos')}</CardTitle>
            <CardDescription>
              {t('repos.noReposDescription')}
              <br />
              <span className="text-xs mt-2 block">
                Current workspace: {lastWorkspace}
              </span>
              <span className="text-xs mt-1 block text-muted-foreground">
                This feature only works with Git repositories. If your workspace contains Git repos, they will appear here.
              </span>
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4">
        {data?.repos.map((repo) => (
          <Card key={repo.repoRoot}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-xl">{repo.name}</CardTitle>
                  <CardDescription className="mt-1">{repo.repoRoot}</CardDescription>
                </div>
                <RepoStatusBadge status={repo.status} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">{t('repos.branch')}</div>
                  <div className="font-medium">{repo.branch}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('repos.uncommitted')}</div>
                  <div className="font-medium">{repo.dirtyFilesCount}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('repos.untracked')}</div>
                  <div className="font-medium">{repo.untrackedFilesCount}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('repos.sync')}</div>
                  <div className="font-medium">
                    {repo.aheadCount > 0 && `↑${repo.aheadCount} `}
                    {repo.behindCount > 0 && `↓${repo.behindCount}`}
                    {repo.aheadCount === 0 && repo.behindCount === 0 && '✓'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RepoStatusBadge({ status }: { status: GitRepoStatus['status'] }) {
  const { t } = useTranslation();

  const variants: Record<GitRepoStatus['status'], { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    clean: { variant: 'default', label: t('repos.status.clean') },
    dirty: { variant: 'destructive', label: t('repos.status.dirty') },
    ahead: { variant: 'secondary', label: t('repos.status.ahead') },
    behind: { variant: 'secondary', label: t('repos.status.behind') },
    diverged: { variant: 'destructive', label: t('repos.status.diverged') },
    error: { variant: 'destructive', label: t('repos.status.error') },
  };

  const config = variants[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
