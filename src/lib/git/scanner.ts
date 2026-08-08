import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import { promises as fs } from 'fs';
import path from 'path';
import type { GitRepoStatus, GitScanOptions, GitScanResult } from './types';

/**
 * Git 仓库扫描服务
 */
export class GitScanner {
  private async refreshRemoteTracking(git: SimpleGit): Promise<void> {
    try {
      const remotes = await git.getRemotes(true);
      if (remotes.length === 0) {
        return;
      }
      await git.raw(['fetch', '--prune', '--quiet']);
    } catch {
      // Best effort only. Offline workspaces should still render local status.
    }
  }

  /**
   * 判断指定路径是否位于 Git 工作树中
   */
  async isGitRepository(repoPath: string): Promise<boolean> {
    try {
      const git: SimpleGit = simpleGit(repoPath);
      const result = await git.revparse(['--is-inside-work-tree']);
      return result.trim() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * 扫描指定路径下的所有 Git 仓库
   */
  async scanWorkspace(options: GitScanOptions = {}): Promise<GitScanResult> {
    const { workspacePath, maxDepth = 3 } = options;
    const repos: GitRepoStatus[] = [];
    const errors: Array<{ path: string; error: string }> = [];

    if (!workspacePath) {
      return {
        repos: [],
        scannedAt: new Date().toISOString(),
        totalRepos: 0,
        errors: [{ path: '', error: 'No workspace path provided' }],
      };
    }

    try {
      const repoPaths = await this.findGitRepos(workspacePath, maxDepth);

      for (const repoPath of repoPaths) {
        try {
          const status = await this.scanRepo(repoPath, workspacePath);
          repos.push(status);
        } catch (error) {
          errors.push({
            path: repoPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      errors.push({
        path: workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      repos,
      scannedAt: new Date().toISOString(),
      totalRepos: repos.length,
      errors,
    };
  }

  /**
   * 扫描单个 Git 仓库的状态
   */
  async scanRepo(repoPath: string, workspacePath: string): Promise<GitRepoStatus> {
    const git: SimpleGit = simpleGit(repoPath);

    try {
      // 获取当前分支
      const branch = await git.revparse(['--abbrev-ref', 'HEAD']);

      await this.refreshRemoteTracking(git);

      // 获取状态
      const status: StatusResult = await git.status();

      // 获取变更文件列表 (Drill-down 支持)
      const changedFiles = status.files.map(f => ({
        path: f.path,
        index: f.index,
        working_dir: f.working_dir,
      }));

      // 获取陈旧分支 (超过30天未更新)
      let staleBranchesCount = 0;
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        // 使用 for-each-ref 检查分支最后更新时间
        const branchRefs = await git.raw([
          'for-each-ref',
          '--format=%(committerdate:unix)',
          'refs/heads'
        ]);
        
        const nowUnix = Math.floor(Date.now() / 1000);
        const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
        
        staleBranchesCount = branchRefs.trim().split('\n')
          .filter(timestamp => {
            const ts = parseInt(timestamp, 10);
            return !isNaN(ts) && (nowUnix - ts) > thirtyDaysInSeconds;
          }).length;
      } catch {
        // ignore
      }

      // 获取 diff summary (含 insertions/deletions)
      let insertions = 0;
      let deletions = 0;
      if (!status.isClean()) {
        try {
          const diffSummary = await git.diffSummary();
          insertions = diffSummary.insertions;
          deletions = diffSummary.deletions;
        } catch {
          // ignore
        }
      }

      // 获取最后一次提交时间
      let lastCommitAt: string | null = null;
      try {
        const log = await git.log({ maxCount: 1 });
        if (log.latest) {
          lastCommitAt = log.latest.date;
        }
      } catch {
        // 可能是空仓库，忽略错误
      }

      // 计算 ahead/behind
      let aheadCount = 0;
      let behindCount = 0;
      try {
        if (status.tracking) {
          aheadCount = status.ahead;
          behindCount = status.behind;
        }
      } catch {
        // 没有远程分支，忽略错误
      }

      // 计算状态
      const dirtyFilesCount = status.files.filter((file) => file.index !== '?' && file.working_dir !== '?').length;
      const untrackedFilesCount = status.files.filter((file) => file.index === '?' || file.working_dir === '?').length;

      let repoStatus: GitRepoStatus['status'] = 'clean';
      if (dirtyFilesCount > 0 || untrackedFilesCount > 0) {
        repoStatus = 'dirty';
      } else if (aheadCount > 0 && behindCount > 0) {
        repoStatus = 'diverged';
      } else if (aheadCount > 0) {
        repoStatus = 'ahead';
      } else if (behindCount > 0) {
        repoStatus = 'behind';
      }

      return {
        repoRoot: repoPath,
        workspacePath,
        name: path.basename(repoPath),
        branch: branch.trim(),
        dirtyFilesCount,
        untrackedFilesCount,
        insertions,
        deletions,
        aheadCount,
        behindCount,
        lastCommitAt,
        status: repoStatus,
        changedFiles,
        staleBranchesCount,
      };
    } catch (error) {
      return {
        repoRoot: repoPath,
        workspacePath,
        name: path.basename(repoPath),
        branch: 'unknown',
        dirtyFilesCount: 0,
        untrackedFilesCount: 0,
        insertions: 0,
        deletions: 0,
        aheadCount: 0,
        behindCount: 0,
        lastCommitAt: null,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        changedFiles: [],
        staleBranchesCount: 0,
      };
    }
  }

  /**
   * 查找指定路径下的所有 Git 仓库
   */
  private async findGitRepos(rootPath: string, maxDepth: number): Promise<string[]> {
    const repos: string[] = [];

    const scan = async (currentPath: string, depth: number) => {
      if (depth > maxDepth) return;

      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        // 检查当前目录是否是 Git 仓库
        const hasGitMarker = entries.some((entry) => entry.name === '.git');
        if (hasGitMarker) {
          repos.push(currentPath);
          return; // 不再扫描子目录
        }

        // 递归扫描子目录
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await scan(path.join(currentPath, entry.name), depth + 1);
          }
        }
      } catch {
        // 忽略无法访问的目录
      }
    };

    await scan(rootPath, 0);
    return repos;
  }

  /**
   * 扫描指定仓库的 worktrees
   */
  async scanWorktrees(repoPath: string): Promise<Array<{
    path: string;
    branch: string;
    head: string;
    isPrunable: boolean;
  }>> {
    try {
      const git: SimpleGit = simpleGit(repoPath);
      const output = await git.raw(['worktree', 'list', '--porcelain']);

      type GitWorktreeInfo = {
        path: string;
        branch: string;
        head: string;
        isPrunable: boolean;
      };

      const worktrees: GitWorktreeInfo[] = [];

      const lines = output.split('\n');
      let currentWorktree: Partial<GitWorktreeInfo> = {};

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          if (currentWorktree.path) {
            worktrees.push({
              path: currentWorktree.path,
              branch: currentWorktree.branch || '',
              head: currentWorktree.head || '',
              isPrunable: currentWorktree.isPrunable || false,
            });
          }
          currentWorktree = {
            path: line.substring('worktree '.length),
            branch: '',
            head: '',
            isPrunable: false,
          };
        } else if (line.startsWith('HEAD ')) {
          currentWorktree.head = line.substring('HEAD '.length);
        } else if (line.startsWith('branch ')) {
          currentWorktree.branch = line.substring('branch '.length).replace('refs/heads/', '');
        } else if (line.startsWith('detached')) {
          currentWorktree.branch = 'detached';
        } else if (line.startsWith('prunable ')) {
          currentWorktree.isPrunable = true;
        }
      }

      // Push last worktree
      if (currentWorktree.path) {
        worktrees.push({
          path: currentWorktree.path,
          branch: currentWorktree.branch || '',
          head: currentWorktree.head || '',
          isPrunable: currentWorktree.isPrunable || false,
        });
      }

      return worktrees;
    } catch (error) {
      console.error('[GitScanner] Failed to scan worktrees:', error);
      return [];
    }
  }

  /**
   * 清理已经丢失目录的 worktree 元数据
   */
  async pruneWorktrees(repoPath: string): Promise<void> {
    const git: SimpleGit = simpleGit(repoPath);
    await git.raw(['worktree', 'prune']);
  }

  /**
   * 创建新的 worktree
   */
  async createWorktree(
    repoPath: string,
    branch: string,
    targetPath: string,
    baseBranch?: string,
  ): Promise<{ path: string; branch: string }> {
    const git: SimpleGit = simpleGit(repoPath);
    // Best-effort prune so manually deleted folders do not keep blocking creation.
    try {
      await git.raw(['worktree', 'prune']);
    } catch {
      // ignore prune failures and let the create command surface the real error
    }
    const args = ['worktree', 'add', '-b', branch, targetPath];
    if (baseBranch) {
      args.push(baseBranch);
    }
    await git.raw(args);
    return { path: targetPath, branch };
  }

  /**
   * 删除 worktree
   */
  async removeWorktree(worktreePath: string, force?: boolean): Promise<void> {
    // Use the worktree path's parent repo to run the command
    const git: SimpleGit = simpleGit(worktreePath);
    const mainRepoPath = await git.revparse(['--git-common-dir']);
    const mainGit: SimpleGit = simpleGit(path.resolve(mainRepoPath.trim(), '..'));
    const args = ['worktree', 'remove', worktreePath];
    if (force) {
      args.push('--force');
    }
    await mainGit.raw(args);
  }

  /**
   * 删除本地分支
   */
  async deleteBranch(repoPath: string, branchName: string, force?: boolean): Promise<void> {
    const git: SimpleGit = simpleGit(repoPath);
    const args = ['branch', force ? '-D' : '-d', branchName];
    await git.raw(args);
  }

  /**
   * 获取仓库的所有分支
   */
  async listBranches(repoPath: string): Promise<{ current: string; all: string[] }> {
    const git: SimpleGit = simpleGit(repoPath);
    const result = await git.branchLocal();
    return { current: result.current, all: result.all };
  }
}

/**
 * 单例实例
 */
export const gitScanner = new GitScanner();
