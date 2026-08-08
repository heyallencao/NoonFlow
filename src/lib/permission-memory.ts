import type { PermissionRequestEvent } from '@/types';

export type PermissionRiskLevel = 'low' | 'medium' | 'high';

interface RememberedPermissionScope {
  toolName: string;
  scope: string;
  updatedAt: number;
}

const permissionMemory = new Map<string, RememberedPermissionScope>();

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
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()))?.trim() || '';
}

function extractCommandValue(toolInput: Record<string, unknown>): string {
  const candidates = [toolInput.command, toolInput.cmd];
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()))?.trim() || '';
}

export function describePermissionScope(
  request: PermissionRequestEvent,
  toolInput: Record<string, unknown> = request.toolInput,
): string {
  const command = extractCommandValue(toolInput);
  if (command) return command.length > 120 ? `${command.slice(0, 117)}...` : command;
  return extractPathLikeValue(toolInput) || request.blockedPath || 'Current session';
}

export function getPermissionRiskLevel(request: PermissionRequestEvent): PermissionRiskLevel {
  const toolName = request.toolName.toLowerCase();
  const command = extractCommandValue(request.toolInput || {}).toLowerCase();
  const targetPath = extractPathLikeValue(request.toolInput || {}).toLowerCase();
  if (
    command.includes('rm ')
    || command.includes('sudo ')
    || command.includes('git reset --hard')
    || command.includes('chmod 777')
    || targetPath.startsWith('/etc')
    || targetPath.startsWith('/usr')
    || targetPath.startsWith('/var')
  ) return 'high';
  if (/bash|execute|write|edit|delete/.test(toolName)) return 'medium';
  return 'low';
}

export function getPermissionRiskReason(request: PermissionRequestEvent): string {
  const level = getPermissionRiskLevel(request);
  if (level === 'high') return 'Touches destructive commands or sensitive paths.';
  if (level === 'medium') return 'Can modify files or execute commands.';
  return 'Mostly scoped to inspection or session flow.';
}

export function getRememberedPermissionScope(toolName: string): RememberedPermissionScope | null {
  return permissionMemory.get(toolName) || null;
}

export function rememberPermissionScope(
  request: PermissionRequestEvent,
  decision: 'allow' | 'allow_session' | 'deny',
  toolInput?: Record<string, unknown>,
) {
  if (decision === 'deny') return;
  permissionMemory.set(request.toolName, {
    toolName: request.toolName,
    scope: describePermissionScope(request, toolInput || request.toolInput),
    updatedAt: Date.now(),
  });
}
