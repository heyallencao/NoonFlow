import type { PermissionRequestEvent } from '@/types';
import {
  getLocalStorageSafe,
  readCompatibleStorageValue,
  writeStorageValue,
} from '@/lib/browser-storage';

const PERMISSION_MEMORY_KEY = 'noonflow:permission-memory';
const LEGACY_PERMISSION_MEMORY_KEYS = ['monolith:permission-memory'] as const;

export type PermissionRiskLevel = 'low' | 'medium' | 'high';

interface RememberedPermissionScope {
  toolName: string;
  scope: string;
  updatedAt: number;
}

type PermissionMemoryMap = Record<string, RememberedPermissionScope>;

function canUseLocalStorage() {
  return typeof window !== 'undefined';
}

function readPermissionMemory(): PermissionMemoryMap {
  if (!canUseLocalStorage()) {
    return {};
  }

  try {
    const raw = readCompatibleStorageValue(
      getLocalStorageSafe(),
      PERMISSION_MEMORY_KEY,
      LEGACY_PERMISSION_MEMORY_KEYS,
    );
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as PermissionMemoryMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePermissionMemory(memory: PermissionMemoryMap) {
  if (!canUseLocalStorage()) {
    return;
  }

  writeStorageValue(getLocalStorageSafe(), PERMISSION_MEMORY_KEY, JSON.stringify(memory));
}

function extractPathLikeValue(toolInput: Record<string, unknown>): string {
  const candidates = [
    toolInput.file_path,
    toolInput.path,
    toolInput.filePath,
    toolInput.cwd,
    toolInput.directory,
    toolInput.blockedPath,
    toolInput.destination,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

function extractCommandValue(toolInput: Record<string, unknown>): string {
  const candidates = [toolInput.command, toolInput.cmd];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

export function describePermissionScope(
  request: PermissionRequestEvent,
  toolInput: Record<string, unknown> = request.toolInput,
): string {
  const command = extractCommandValue(toolInput);
  if (command) {
    return command.length > 120 ? `${command.slice(0, 117)}...` : command;
  }

  const path = extractPathLikeValue(toolInput);
  if (path) {
    return path;
  }

  if (request.blockedPath) {
    return request.blockedPath;
  }

  return 'Current session';
}

export function getPermissionRiskLevel(request: PermissionRequestEvent): PermissionRiskLevel {
  const toolName = request.toolName.toLowerCase();
  const toolInput = request.toolInput || {};
  const command = extractCommandValue(toolInput).toLowerCase();
  const path = extractPathLikeValue(toolInput).toLowerCase();

  if (
    command.includes('rm ') ||
    command.includes('sudo ') ||
    command.includes('git reset --hard') ||
    command.includes('chmod 777') ||
    path.startsWith('/etc') ||
    path.startsWith('/usr') ||
    path.startsWith('/var')
  ) {
    return 'high';
  }

  if (
    toolName.includes('bash') ||
    toolName.includes('execute') ||
    toolName.includes('write') ||
    toolName.includes('edit') ||
    toolName.includes('delete')
  ) {
    return 'medium';
  }

  return 'low';
}

export function getPermissionRiskReason(request: PermissionRequestEvent): string {
  const riskLevel = getPermissionRiskLevel(request);

  switch (riskLevel) {
    case 'high':
      return 'Touches destructive commands or sensitive paths.';
    case 'medium':
      return 'Can modify files or execute commands.';
    default:
      return 'Mostly scoped to inspection or session flow.';
  }
}

export function getRememberedPermissionScope(toolName: string): RememberedPermissionScope | null {
  const memory = readPermissionMemory();
  return memory[toolName] || null;
}

export function rememberPermissionScope(
  request: PermissionRequestEvent,
  decision: 'allow' | 'allow_session' | 'deny',
  toolInput?: Record<string, unknown>,
) {
  if (decision === 'deny') {
    return;
  }

  const memory = readPermissionMemory();
  memory[request.toolName] = {
    toolName: request.toolName,
    scope: describePermissionScope(request, toolInput || request.toolInput),
    updatedAt: Date.now(),
  };
  writePermissionMemory(memory);
}
