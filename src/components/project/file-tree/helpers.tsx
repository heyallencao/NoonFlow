import type { ReactNode } from 'react';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  CodeIcon,
  File01Icon,
  SourceCodeIcon,
} from '@hugeicons/core-free-icons';

import type { FileTreeNode } from '@/types';

export const ROOT_TREE_SCAN_DEPTH = 1;
export const DIRECTORY_EXPAND_SCAN_DEPTH = 1;
export const FILE_TREE_EVENT_DEBOUNCE_MS = 250;
export const CONTEXT_MENU_WIDTH = 196;

export type FileNodeType = 'file' | 'directory';

export function getFileIcon(extension?: string): ReactNode {
  switch (extension) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'py':
    case 'rb':
    case 'rs':
    case 'go':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'cs':
    case 'swift':
    case 'kt':
    case 'dart':
    case 'lua':
    case 'php':
    case 'zig':
      return <HugeiconsIcon icon={SourceCodeIcon} className="size-4 text-muted-foreground" />;
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return <HugeiconsIcon icon={CodeIcon} className="size-4 text-muted-foreground" />;
    case 'md':
    case 'mdx':
    case 'txt':
    case 'csv':
      return <HugeiconsIcon icon={File01Icon} className="size-4 text-muted-foreground" />;
    default:
      return <HugeiconsIcon icon={File01Icon} className="size-4 text-muted-foreground" />;
  }
}

function containsMatch(node: FileTreeNode, query: string): boolean {
  const lowerQuery = query.toLowerCase();
  if (node.name.toLowerCase().includes(lowerQuery)) {
    return true;
  }
  if (node.children) {
    return node.children.some((child) => containsMatch(child, lowerQuery));
  }
  return false;
}

export function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  if (!query) {
    return nodes;
  }

  return nodes
    .filter((node) => containsMatch(node, query))
    .map((node) => ({
      ...node,
      children: node.children ? filterTree(node.children, query) : undefined,
    }));
}

export function validateNodeName(input: string): string {
  const name = input.trim();
  if (!name || name === '.' || name === '..') {
    return '';
  }
  if (name.includes('/') || name.includes('\\')) {
    return '';
  }
  return name;
}

export function toComparablePath(inputPath: string): string {
  return inputPath.replaceAll('\\', '/').normalize('NFC');
}

export function getRelativePath(targetPath: string, basePath: string): string {
  const normalizedTarget = toComparablePath(targetPath);
  const normalizedBase = toComparablePath(basePath).replace(/\/+$/, '');

  if (normalizedTarget === normalizedBase) {
    return '.';
  }
  if (normalizedTarget.startsWith(`${normalizedBase}/`)) {
    return normalizedTarget.slice(normalizedBase.length + 1);
  }
  return targetPath;
}

export function mergeDirectoryNodes(nextNodes: FileTreeNode[], previousNodes: FileTreeNode[]): FileTreeNode[] {
  if (previousNodes.length === 0) {
    return nextNodes;
  }

  const previousByPath = new Map(previousNodes.map((node) => [node.path, node]));

  return nextNodes.map((node) => {
    if (node.type !== 'directory') {
      return node;
    }

    const previousNode = previousByPath.get(node.path);
    if (previousNode?.type !== 'directory' || !previousNode.children) {
      return node;
    }

    return {
      ...node,
      children: previousNode.children,
    };
  });
}

export function replaceDirectoryChildren(
  nodes: FileTreeNode[],
  targetPath: string,
  nextChildren: FileTreeNode[]
): FileTreeNode[] {
  let changed = false;

  const updatedNodes = nodes.map((node) => {
    if (node.type === 'directory' && node.path === targetPath) {
      changed = true;
      return {
        ...node,
        children: mergeDirectoryNodes(nextChildren, node.children || []),
      };
    }

    if (node.type === 'directory' && node.children) {
      const updatedChildren = replaceDirectoryChildren(node.children, targetPath, nextChildren);
      if (updatedChildren !== node.children) {
        changed = true;
        return {
          ...node,
          children: updatedChildren,
        };
      }
    }

    return node;
  });

  return changed ? updatedNodes : nodes;
}

export function hasDirectoryPath(nodes: FileTreeNode[], targetPath: string): boolean {
  for (const node of nodes) {
    if (node.type !== 'directory') {
      continue;
    }
    if (node.path === targetPath) {
      return true;
    }
    if (node.children && hasDirectoryPath(node.children, targetPath)) {
      return true;
    }
  }
  return false;
}

export function getPathDepth(inputPath: string): number {
  return toComparablePath(inputPath).split('/').filter(Boolean).length;
}
