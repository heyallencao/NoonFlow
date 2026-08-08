/**
 * Git 仓库扫描相关类型定义
 */

export interface GitRepoStatus {
  repoRoot: string;
  workspacePath: string;
  name: string;
  branch: string;
  dirtyFilesCount: number;
  untrackedFilesCount: number;
  insertions: number;
  deletions: number;
  aheadCount: number;
  behindCount: number;
  lastCommitAt: string | null;
  status: 'clean' | 'dirty' | 'ahead' | 'behind' | 'diverged' | 'error';
  error?: string;
  // 新增：详细详情
  changedFiles?: Array<{
    path: string;
    index: string;
    working_dir: string;
  }>;
  staleBranchesCount?: number;
}

export interface GitScanOptions {
  workspacePath?: string;
  includeSubmodules?: boolean;
  maxDepth?: number;
}

export interface GitScanResult {
  repos: GitRepoStatus[];
  scannedAt: string;
  totalRepos: number;
  errors: Array<{ path: string; error: string }>;
}
