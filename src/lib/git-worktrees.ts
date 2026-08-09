import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Worktree, WorktreeDeleteStatus } from '@/types';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

export const MAX_MANAGED_WORKTREES_PER_WORKSPACE = 8;

interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface ParsedGitWorktree {
  path: string;
  head: string;
  branch: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

export class WorktreeOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorktreeOperationError';
  }
}

function getManagedWorktreeRoot(): string {
  const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.noonflow');
  return path.join(dataDir, 'worktrees');
}

function normalizeFsPath(input: string): string {
  const resolved = path.resolve(input.trim());
  try {
    return fsSync.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(normalizeFsPath(parentPath), normalizeFsPath(candidatePath));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function readableGitError(result: GitCommandResult, fallback: string): string {
  const message = (result.stderr || result.stdout).trim();
  return message || fallback;
}

async function runGitResult(cwd: string, args: string[]): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
    });
    return {
      ok: true,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
    };
  } catch (error) {
    const gitError = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      ok: false,
      stdout: String(gitError.stdout || ''),
      stderr: String(gitError.stderr || gitError.message || ''),
    };
  }
}

async function runGit(cwd: string, args: string[], fallback: string): Promise<string> {
  const result = await runGitResult(cwd, args);
  if (!result.ok) {
    throw new WorktreeOperationError(
      'GIT_COMMAND_FAILED',
      readableGitError(result, fallback),
      409,
    );
  }
  return result.stdout;
}

async function assertDirectory(candidate: string): Promise<string> {
  const normalized = normalizeFsPath(candidate);
  try {
    const stat = await fs.stat(normalized);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new WorktreeOperationError('DIRECTORY_NOT_FOUND', 'Workspace directory does not exist', 404);
  }
  return normalized;
}

export function parseWorktreePorcelain(output: string): ParsedGitWorktree[] {
  const records: ParsedGitWorktree[] = [];
  let current: Partial<ParsedGitWorktree> | null = null;

  const commitCurrent = () => {
    if (!current?.path) return;
    records.push({
      path: current.path,
      head: current.head || '',
      branch: current.branch || '',
      detached: Boolean(current.detached),
      bare: Boolean(current.bare),
      locked: Boolean(current.locked),
      prunable: Boolean(current.prunable),
    });
    current = null;
  };

  const fields = output.includes('\0') ? output.split('\0') : output.split(/\r?\n/);
  for (const field of fields) {
    if (!field) {
      commitCurrent();
      continue;
    }
    if (field.startsWith('worktree ')) {
      commitCurrent();
      current = { path: field.slice('worktree '.length) };
      continue;
    }
    if (!current) continue;
    if (field.startsWith('HEAD ')) current.head = field.slice('HEAD '.length);
    else if (field.startsWith('branch ')) current.branch = field.slice('branch '.length).replace(/^refs\/heads\//, '');
    else if (field === 'detached') current.detached = true;
    else if (field === 'bare') current.bare = true;
    else if (field === 'locked' || field.startsWith('locked ')) current.locked = true;
    else if (field === 'prunable' || field.startsWith('prunable ')) current.prunable = true;
  }
  commitCurrent();
  return records;
}

async function readRepositoryWorktrees(workspacePath: string): Promise<{
  requestedPath: string;
  primaryPath: string;
  commonGitDir: string;
  records: ParsedGitWorktree[];
}> {
  const requestedPath = await assertDirectory(workspacePath);
  const insideResult = await runGitResult(requestedPath, ['rev-parse', '--is-inside-work-tree']);
  if (!insideResult.ok || insideResult.stdout.trim() !== 'true') {
    throw new WorktreeOperationError(
      'NOT_A_GIT_REPOSITORY',
      'Creating worktrees is only supported for Git repositories',
      409,
    );
  }

  let outputResult = await runGitResult(requestedPath, ['worktree', 'list', '--porcelain', '-z']);
  if (!outputResult.ok) {
    outputResult = await runGitResult(requestedPath, ['worktree', 'list', '--porcelain']);
  }
  if (!outputResult.ok) {
    throw new WorktreeOperationError(
      'GIT_COMMAND_FAILED',
      readableGitError(outputResult, 'Failed to list Git worktrees'),
      409,
    );
  }

  const records = parseWorktreePorcelain(outputResult.stdout).filter((record) => !record.bare);
  if (records.length === 0) {
    throw new WorktreeOperationError('WORKTREE_NOT_FOUND', 'No Git worktree was found', 404);
  }

  const commonDirOutput = await runGit(
    requestedPath,
    ['rev-parse', '--git-common-dir'],
    'Failed to resolve Git metadata directory',
  );
  const rawCommonDir = commonDirOutput.trim();
  const commonGitDir = path.resolve(requestedPath, rawCommonDir);

  return {
    requestedPath,
    primaryPath: normalizeFsPath(records[0].path),
    commonGitDir,
    records,
  };
}

function toWorktree(
  record: ParsedGitWorktree,
  primaryPath: string,
  commonGitDir: string,
): Worktree {
  const worktreePath = normalizeFsPath(record.path);
  const branch = record.detached ? '' : record.branch;
  const detachedName = record.head ? `detached@${record.head.slice(0, 7)}` : 'detached';
  return {
    id: crypto.createHash('sha256').update(`${commonGitDir}\0${worktreePath}`).digest('hex').slice(0, 20),
    workspace_path: primaryPath,
    worktree_path: worktreePath,
    branch,
    head: record.head,
    name: branch || detachedName || path.basename(worktreePath),
    is_default: worktreePath === primaryPath,
    is_prunable: record.prunable,
    is_locked: record.locked,
    is_managed: isPathInside(getManagedWorktreeRoot(), worktreePath),
  };
}

export async function listWorktrees(workspacePath: string): Promise<{
  workspacePath: string;
  worktrees: Worktree[];
}> {
  const repository = await readRepositoryWorktrees(workspacePath);
  return {
    workspacePath: repository.primaryPath,
    worktrees: repository.records.map((record) => (
      toWorktree(record, repository.primaryPath, repository.commonGitDir)
    )),
  };
}

export async function listWorktreeBranches(workspacePath: string): Promise<{
  current: string;
  branches: string[];
}> {
  const repository = await readRepositoryWorktrees(workspacePath);
  const branchOutput = await runGit(
    repository.requestedPath,
    ['branch', '--format=%(refname:short)'],
    'Failed to list Git branches',
  );
  const currentResult = await runGitResult(repository.requestedPath, ['branch', '--show-current']);
  return {
    current: currentResult.ok ? currentResult.stdout.trim() : '',
    branches: branchOutput.split(/\r?\n/).map((branch) => branch.trim()).filter(Boolean),
  };
}

function sanitizePathSegment(input: string, fallback: string): string {
  const cleaned = input
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : fallback;
}

async function chooseTargetPath(primaryPath: string, branch: string, existingPaths: Set<string>): Promise<string> {
  const projectName = sanitizePathSegment(path.basename(primaryPath), 'workspace');
  const projectHash = crypto.createHash('sha256').update(primaryPath).digest('hex').slice(0, 8);
  const branchSegment = sanitizePathSegment(branch, 'worktree');
  const projectRoot = path.join(getManagedWorktreeRoot(), `${projectName}-${projectHash}`);
  await fs.mkdir(projectRoot, { recursive: true });
  const canonicalProjectRoot = await fs.realpath(projectRoot);

  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const candidate = path.join(canonicalProjectRoot, suffix === 1 ? branchSegment : `${branchSegment}-${suffix}`);
    if (existingPaths.has(normalizeFsPath(candidate))) continue;
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }

  throw new WorktreeOperationError('WORKTREE_PATH_UNAVAILABLE', 'Unable to allocate a worktree directory', 409);
}

export async function createManagedWorktree(input: {
  workspacePath: string;
  branch: string;
  baseBranch?: string;
}): Promise<Worktree> {
  const repository = await readRepositoryWorktrees(input.workspacePath);
  const branch = input.branch.trim();
  if (!branch) {
    throw new WorktreeOperationError('BRANCH_REQUIRED', 'Branch name is required');
  }

  const branchCheck = await runGitResult(repository.requestedPath, ['check-ref-format', '--branch', branch]);
  if (!branchCheck.ok) {
    throw new WorktreeOperationError('INVALID_BRANCH_NAME', 'Branch name is not valid', 400);
  }

  const existingBranch = await runGitResult(
    repository.requestedPath,
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
  );
  if (existingBranch.ok) {
    throw new WorktreeOperationError('BRANCH_ALREADY_EXISTS', `Branch "${branch}" already exists`, 409);
  }

  const branchInfo = await listWorktreeBranches(repository.requestedPath);
  const baseBranch = input.baseBranch?.trim() || branchInfo.current || 'HEAD';
  if (baseBranch !== 'HEAD' && !branchInfo.branches.includes(baseBranch)) {
    throw new WorktreeOperationError('BASE_BRANCH_NOT_FOUND', `Base branch "${baseBranch}" does not exist`, 400);
  }

  const currentWorktrees = repository.records.map((record) => (
    toWorktree(record, repository.primaryPath, repository.commonGitDir)
  ));
  const managedCount = currentWorktrees.filter((worktree) => !worktree.is_default && worktree.is_managed).length;
  if (managedCount >= MAX_MANAGED_WORKTREES_PER_WORKSPACE) {
    throw new WorktreeOperationError(
      'WORKTREE_LIMIT_REACHED',
      `Workspace worktree limit reached (max ${MAX_MANAGED_WORKTREES_PER_WORKSPACE})`,
      409,
    );
  }

  const targetPath = await chooseTargetPath(
    repository.primaryPath,
    branch,
    new Set(currentWorktrees.map((worktree) => worktree.worktree_path)),
  );

  await runGitResult(repository.requestedPath, ['worktree', 'prune']);
  await runGit(
    repository.requestedPath,
    ['worktree', 'add', '-b', branch, targetPath, baseBranch],
    'Failed to create Git worktree',
  );

  const refreshed = await listWorktrees(repository.requestedPath);
  const created = refreshed.worktrees.find((worktree) => worktree.worktree_path === normalizeFsPath(targetPath));
  if (!created) {
    throw new WorktreeOperationError('WORKTREE_CREATE_INCOMPLETE', 'Git created the worktree but NoonFlow could not resolve it', 500);
  }
  return created;
}

async function findWorktree(workspacePath: string, worktreePath: string): Promise<{
  repositoryPath: string;
  worktree: Worktree;
}> {
  const listed = await listWorktrees(workspacePath);
  const normalizedTarget = normalizeFsPath(worktreePath);
  const worktree = listed.worktrees.find((entry) => entry.worktree_path === normalizedTarget);
  if (!worktree) {
    throw new WorktreeOperationError('WORKTREE_NOT_FOUND', 'Worktree is not registered in this repository', 404);
  }
  return { repositoryPath: listed.workspacePath, worktree };
}

export async function getWorktreeDeleteStatus(
  workspacePath: string,
  worktreePath: string,
): Promise<WorktreeDeleteStatus> {
  const { worktree } = await findWorktree(workspacePath, worktreePath);
  const statusResult = await runGitResult(worktree.worktree_path, ['status', '--porcelain=v1', '-uall']);
  if (!statusResult.ok) {
    return {
      checked: false,
      has_changes: false,
      dirty_files_count: 0,
      untracked_files_count: 0,
    };
  }

  const lines = statusResult.stdout.split(/\r?\n/).filter(Boolean);
  const untrackedFilesCount = lines.filter((line) => line.startsWith('??')).length;
  const dirtyFilesCount = lines.length - untrackedFilesCount;
  return {
    checked: true,
    has_changes: lines.length > 0,
    dirty_files_count: dirtyFilesCount,
    untracked_files_count: untrackedFilesCount,
  };
}

export async function removeManagedWorktree(input: {
  workspacePath: string;
  worktreePath: string;
  forceDirty?: boolean;
  deleteBranch?: boolean;
}): Promise<{ deletedBranch: boolean; branchDeleteError?: string }> {
  const { repositoryPath, worktree } = await findWorktree(input.workspacePath, input.worktreePath);
  if (worktree.is_default) {
    throw new WorktreeOperationError('DEFAULT_WORKTREE', 'Cannot delete the local checkout', 403);
  }
  if (!worktree.is_managed) {
    throw new WorktreeOperationError(
      'EXTERNAL_WORKTREE',
      'NoonFlow can open external worktrees but only deletes worktrees it created',
      403,
    );
  }
  if (worktree.is_locked) {
    throw new WorktreeOperationError('LOCKED_WORKTREE', 'This worktree is locked by Git', 409);
  }

  const deleteStatus = await getWorktreeDeleteStatus(repositoryPath, worktree.worktree_path);
  if (deleteStatus.checked && deleteStatus.has_changes && !input.forceDirty) {
    throw new WorktreeOperationError(
      'DIRTY_WORKTREE_CONFIRMATION_REQUIRED',
      'Worktree has uncommitted changes and requires explicit confirmation',
      409,
      { delete_status: deleteStatus },
    );
  }

  const removeArgs = ['worktree', 'remove'];
  if (deleteStatus.has_changes && input.forceDirty) removeArgs.push('--force');
  removeArgs.push(worktree.worktree_path);
  await runGit(repositoryPath, removeArgs, 'Failed to remove Git worktree');

  let deletedBranch = false;
  let branchDeleteError: string | undefined;
  if (input.deleteBranch && worktree.branch) {
    const branchDeleteResult = await runGitResult(
      repositoryPath,
      ['branch', '-d', worktree.branch],
    );
    if (branchDeleteResult.ok) {
      deletedBranch = true;
    } else {
      branchDeleteError = readableGitError(
        branchDeleteResult,
        `Worktree was removed, but branch "${worktree.branch}" could not be deleted`,
      );
    }
  }
  await runGitResult(repositoryPath, ['worktree', 'prune']);
  return { deletedBranch, branchDeleteError };
}
