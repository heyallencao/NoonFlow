import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { FILE_PREVIEW_MAX_BYTES } from '@/lib/doc-preview-mode';
import type { FileTreeNode, FilePreview } from '@/types';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  '.cache',
  '.turbo',
  'coverage',
  '.output',
  'build',
]);

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  mdx: 'markdown',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
  prisma: 'prisma',
  env: 'dotenv',
  lua: 'lua',
  r: 'r',
  php: 'php',
  dart: 'dart',
  zig: 'zig',
};

export function getFileLanguage(ext: string): string {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  return LANGUAGE_MAP[normalized] || 'plaintext';
}

function normalizePathForComparison(inputPath: string): string {
  const resolved = path.resolve(inputPath).normalize('NFC');
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return resolved.toLowerCase();
  }
  return resolved;
}

function isWithinBase(basePath: string, targetPath: string): boolean {
  return targetPath.startsWith(basePath + path.sep) || targetPath === basePath;
}

function tryRealpath(inputPath: string): string | null {
  try {
    return fsSync.realpathSync.native(path.resolve(inputPath));
  } catch {
    return null;
  }
}

export function isPathSafe(basePath: string, targetPath: string): boolean {
  const resolvedBase = normalizePathForComparison(basePath);
  const resolvedTarget = normalizePathForComparison(targetPath);
  if (isWithinBase(resolvedBase, resolvedTarget)) {
    return true;
  }

  // Handle symlink aliases (e.g. workspace path vs resolved canonical path).
  // If paths do not exist yet, realpath fails and we fall back to the direct check above.
  const realBase = tryRealpath(basePath);
  const realTarget = tryRealpath(targetPath);
  if (!realBase || !realTarget) {
    return false;
  }

  return isWithinBase(
    normalizePathForComparison(realBase),
    normalizePathForComparison(realTarget)
  );
}

/**
 * Check if a path is a filesystem root (e.g., `/`, `C:\`, `D:\`).
 * Used to prevent using root as a baseDir for file browsing.
 */
export function isRootPath(p: string): boolean {
  const resolved = path.resolve(p);
  return resolved === path.parse(resolved).root;
}

export async function scanDirectory(dir: string, depth: number = 3): Promise<FileTreeNode[]> {
  const resolvedDir = path.resolve(dir);

  try {
    await fs.access(resolvedDir);
  } catch {
    return [];
  }

  return scanDirectoryRecursive(resolvedDir, depth);
}

export interface FlatScanResult {
  items: FileTreeNode[];
  hasMore: boolean;
  nextOffset: number;
}

interface ScanDirectoryFlatOptions {
  filter?: string;
  offset?: number;
  limit?: number;
}

function normalizeSlashes(value: string): string {
  return value.replaceAll('\\', '/');
}

export async function scanDirectoryFlat(
  dir: string,
  depth: number = 3,
  options: ScanDirectoryFlatOptions = {},
): Promise<FlatScanResult> {
  const resolvedDir = path.resolve(dir);

  try {
    await fs.access(resolvedDir);
  } catch {
    return { items: [], hasMore: false, nextOffset: 0 };
  }

  const normalizedFilter = (options.filter || '').trim().toLowerCase().replaceAll('\\', '/');
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? 20);

  const items: FileTreeNode[] = [];
  let matchedCount = 0;
  let hasMore = false;

  const matchesFilter = (entryName: string, fullPath: string): boolean => {
    if (!normalizedFilter) return true;
    const absolutePath = normalizeSlashes(fullPath).toLowerCase();
    const relativePath = normalizeSlashes(path.relative(resolvedDir, fullPath)).toLowerCase();
    const lowerName = entryName.toLowerCase();
    return absolutePath.includes(normalizedFilter)
      || relativePath.includes(normalizedFilter)
      || lowerName.includes(normalizedFilter);
  };

  const maybeAppend = (node: FileTreeNode): boolean => {
    matchedCount += 1;

    if (matchedCount <= offset) {
      return false;
    }

    if (items.length < limit) {
      items.push(node);
      return false;
    }

    hasMore = true;
    return true;
  };

  const walk = async (currentDir: string, remainingDepth: number): Promise<boolean> => {
    if (remainingDepth <= 0) return false;

    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return false;
    }

    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (entry.name.startsWith('.') && !entry.name.startsWith('.env')) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;

        if (matchesFilter(entry.name, fullPath)) {
          const shouldStop = maybeAppend({
            name: entry.name,
            path: fullPath,
            type: 'directory',
          });
          if (shouldStop) return true;
        }

        const childShouldStop = await walk(fullPath, remainingDepth - 1);
        if (childShouldStop) return true;
      } else if (entry.isFile()) {
        if (!matchesFilter(entry.name, fullPath)) {
          continue;
        }

        const ext = path.extname(entry.name).replace(/^\./, '');
        const shouldStop = maybeAppend({
          name: entry.name,
          path: fullPath,
          type: 'file',
          extension: ext || undefined,
        });
        if (shouldStop) return true;
      }
    }

    return false;
  };

  await walk(resolvedDir, depth);

  return {
    items,
    hasMore,
    nextOffset: offset + items.length,
  };
}

async function scanDirectoryRecursive(dir: string, depth: number): Promise<FileTreeNode[]> {
  if (depth <= 0) return [];

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileTreeNode[] = [];

  // Sort: directories first, then files, both alphabetically
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    // Skip hidden files/dirs (except common config files)
    if (entry.name.startsWith('.') && !entry.name.startsWith('.env')) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      const children = await scanDirectoryRecursive(fullPath, depth - 1);
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'directory',
        children,
      });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).replace(/^\./, '');
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'file',
        extension: ext || undefined,
      });
    }
  }

  return nodes;
}

const BINARY_SAMPLE_BYTES = 8 * 1024;
const TEXT_CONTROL_BYTES = new Set([7, 8, 9, 10, 12, 13, 27]);

export function isLikelyBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, BINARY_SAMPLE_BYTES));
  let suspiciousByteCount = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }

    if (byte < 32 && !TEXT_CONTROL_BYTES.has(byte)) {
      suspiciousByteCount += 1;
    }
  }

  return suspiciousByteCount / sample.length > 0.3;
}

export async function readFilePreview(filePath: string, maxLines: number = 200): Promise<FilePreview> {
  const resolvedPath = path.resolve(filePath);

  try {
    await fs.access(resolvedPath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const ext = path.extname(resolvedPath).replace(/^\./, '');
  const language = getFileLanguage(ext);

  if (stat.size === 0) {
    return {
      path: resolvedPath,
      content: '',
      language,
      line_count: 0,
      line_count_exact: true,
      size: 0,
      truncated: false,
      binary: false,
    };
  }

  const handle = await fs.open(resolvedPath, 'r');

  try {
    const bytesToRead = Math.min(stat.size, FILE_PREVIEW_MAX_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    const sample = buffer.subarray(0, bytesRead);

    if (isLikelyBinaryBuffer(sample)) {
      return {
        path: resolvedPath,
        content: '',
        language,
        line_count: 0,
        line_count_exact: false,
        size: stat.size,
        truncated: stat.size > 0,
        binary: true,
      };
    }

    const text = sample.toString('utf-8');
    const lines = text.split(/\r?\n/);
    const reachedEnd = bytesRead >= stat.size;
    const truncatedByLines = lines.length > maxLines;
    const truncatedByBytes = !reachedEnd;
    const truncated = truncatedByLines || truncatedByBytes;

    return {
      path: resolvedPath,
      content: lines.slice(0, maxLines).join('\n'),
      language,
      line_count: reachedEnd && !truncatedByLines ? lines.length : Math.min(lines.length, maxLines),
      line_count_exact: reachedEnd && !truncatedByLines,
      size: stat.size,
      truncated,
      binary: false,
    };
  } finally {
    await handle.close();
  }
}
