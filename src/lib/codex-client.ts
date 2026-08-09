import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'os';
import path from 'node:path';
import { findCodexBinary, getCodexVersion } from './platform';
import { getSetting } from './db';
import { isDangerouslySkipPermissionsEnabled } from './assistant-permissions';
import { resolvePreferredCodexModel } from './codex-model';
import {
  appendCodexDelta,
  buildCodexThreadStartedStatusEvent,
  extractCodexItemEnvelope,
} from './codex/event-mapper';
import {
  CodexAppServerClient,
  type AppServerNotification,
  type AppServerRequest,
} from './codex/app-server';
import { isCliVersionAtLeast } from './context-cli-version';
import { normalizeContextLimitErrorMessage } from './context-budget';
import {
  buildNativeTokenState,
  createUnavailableRuntimeContextState,
  getRuntimeContextState,
  setRuntimeContextState,
  updateRuntimeContextState,
} from './context-runtime';
import { registerPendingPermission } from './permission-registry';
import { RuntimeActivityAdapter } from './agent-runtime/sdk-adapter';
import type { FileAttachment, SSEEvent, TokenUsage } from '@/types';
import { SETTING_KEYS } from '@/types';
import { buildCodexRuntimeSettings, type CodexRuntimeSettings } from './codex/runtime-settings';

const WINDOWS_CODEX_TARGETS: Partial<Record<NodeJS.Architecture, {
  packageName: string;
  targetTriple: string;
}>> = {
  x64: {
    packageName: '@openai/codex-win32-x64',
    targetTriple: 'x86_64-pc-windows-msvc',
  },
  arm64: {
    packageName: '@openai/codex-win32-arm64',
    targetTriple: 'aarch64-pc-windows-msvc',
  },
};

type CodexManagedPackageManager = 'NPM' | 'PNPM' | 'BUN';

interface WindowsCodexNativePackage {
  executablePath: string;
  pathDirs: string[];
  managedPackageRoot: string;
  managedBy: CodexManagedPackageManager;
}

interface CodexAppServerLaunchConfig {
  executablePath: string;
  env: NodeJS.ProcessEnv;
}

function createRequireFromPath(filename: string): ReturnType<typeof createRequire> {
  // Calling through Reflect keeps webpack from treating a runtime-discovered
  // global Codex entrypoint as a statically analyzable module dependency.
  return Reflect.apply(createRequire, undefined, [filename]) as ReturnType<typeof createRequire>;
}

function isFile(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function existingDirectories(...targetPaths: string[]): string[] {
  return targetPaths.filter((targetPath) => {
    try {
      return fs.statSync(targetPath).isDirectory();
    } catch {
      return false;
    }
  });
}

function findCodexEntrypointFromWindowsWrapper(wrapperPath: string): string | undefined {
  let wrapperSource: string;
  try {
    wrapperSource = fs.readFileSync(wrapperPath, 'utf8');
  } catch {
    return undefined;
  }

  const entrypointMatch = wrapperSource.match(
    /%(?:~dp0|dp0%)[\\/]+([^"'\r\n]*?node_modules[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js)/i,
  );
  if (!entrypointMatch) {
    return undefined;
  }

  const relativeEntrypoint = entrypointMatch[1].replace(/[\\/]+/g, path.sep);
  return path.resolve(path.dirname(wrapperPath), relativeEntrypoint);
}

function detectCodexPackageManager(
  codexEntrypoint: string,
  codexPackageRoot: string,
): CodexManagedPackageManager {
  const normalizedPaths = [codexEntrypoint, codexPackageRoot]
    .map((targetPath) => targetPath.replace(/\\/g, '/').toLowerCase());
  if (normalizedPaths.some((targetPath) => targetPath.includes('/.bun/install/global/'))) {
    return 'BUN';
  }
  if (normalizedPaths.some((targetPath) => targetPath.includes('/.pnpm/'))) {
    return 'PNPM';
  }
  return 'NPM';
}

function findWindowsCodexNativePackage(
  wrapperPath: string,
  architecture: NodeJS.Architecture,
): WindowsCodexNativePackage | undefined {
  const target = WINDOWS_CODEX_TARGETS[architecture];
  if (!target) {
    return undefined;
  }

  const codexEntrypoint = findCodexEntrypointFromWindowsWrapper(wrapperPath);
  if (!codexEntrypoint) {
    return undefined;
  }

  const lexicalCodexPackageRoot = path.dirname(path.dirname(codexEntrypoint));
  let managedPackageRoot = lexicalCodexPackageRoot;
  try {
    managedPackageRoot = fs.realpathSync(lexicalCodexPackageRoot);
  } catch {
    // A stale wrapper will fail native package resolution below.
  }

  const packageRoots = new Set<string>();
  try {
    const requireFromCodex = createRequireFromPath(codexEntrypoint);
    const packageJsonPath = requireFromCodex.resolve(`${target.packageName}/package.json`);
    packageRoots.add(path.dirname(packageJsonPath));
  } catch {
    // Fall back to the normal npm sibling layout below.
  }

  packageRoots.add(path.join(
    path.dirname(lexicalCodexPackageRoot),
    path.basename(target.packageName),
  ));
  packageRoots.add(path.join(
    path.dirname(managedPackageRoot),
    path.basename(target.packageName),
  ));

  for (const packageRoot of packageRoots) {
    const targetRoot = path.join(packageRoot, 'vendor', target.targetTriple);
    const currentExecutable = path.join(targetRoot, 'bin', 'codex.exe');
    if (isFile(currentExecutable) && isFile(path.join(targetRoot, 'codex-package.json'))) {
      return {
        executablePath: currentExecutable,
        pathDirs: existingDirectories(path.join(targetRoot, 'codex-path')),
        managedPackageRoot,
        managedBy: detectCodexPackageManager(codexEntrypoint, managedPackageRoot),
      };
    }

    const legacyExecutable = path.join(targetRoot, 'codex', 'codex.exe');
    if (isFile(legacyExecutable)) {
      return {
        executablePath: legacyExecutable,
        pathDirs: existingDirectories(path.join(targetRoot, 'path')),
        managedPackageRoot,
        managedBy: detectCodexPackageManager(codexEntrypoint, managedPackageRoot),
      };
    }
  }

  return undefined;
}

function prependCodexPathDirs(
  env: NodeJS.ProcessEnv,
  pathDirs: string[],
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const result = { ...env };
  if (pathDirs.length === 0) {
    return result;
  }

  const matchingPathKeys = Object.keys(result).filter((key) => key.toLowerCase() === 'path');
  const pathKey = platform === 'win32'
    ? (matchingPathKeys.includes('Path') ? 'Path' : matchingPathKeys.at(-1) || 'PATH')
    : 'PATH';
  if (platform === 'win32') {
    for (const key of matchingPathKeys) {
      if (key !== pathKey) {
        delete result[key];
      }
    }
  }

  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  const existingEntries = (result[pathKey] || '')
    .split(delimiter)
    .filter((entry) => entry && !pathDirs.includes(entry));
  result[pathKey] = [...pathDirs, ...existingEntries].join(delimiter);
  return result;
}

function resolveCodexAppServerLaunch(
  binary: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  architecture: NodeJS.Architecture = process.arch,
): CodexAppServerLaunchConfig {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(binary)) {
    return { executablePath: binary, env };
  }

  const nativePackage = findWindowsCodexNativePackage(binary, architecture);
  if (nativePackage) {
    const launchEnv = prependCodexPathDirs(env, nativePackage.pathDirs, platform);
    delete launchEnv.CODEX_MANAGED_BY_NPM;
    delete launchEnv.CODEX_MANAGED_BY_PNPM;
    delete launchEnv.CODEX_MANAGED_BY_BUN;
    launchEnv.CODEX_MANAGED_PACKAGE_ROOT = nativePackage.managedPackageRoot;
    launchEnv[`CODEX_MANAGED_BY_${nativePackage.managedBy}`] = '1';
    return {
      executablePath: nativePackage.executablePath,
      env: launchEnv,
    };
  }

  throw new Error(
    `Codex CLI wrapper was found, but its native Windows executable could not be resolved: ${binary}. Reinstall Codex with npm install -g @openai/codex.`,
  );
}

export function __resolveCodexAppServerLaunchForTests(
  binary: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): CodexAppServerLaunchConfig {
  return resolveCodexAppServerLaunch(binary, env, platform, architecture);
}

interface CodexStreamOptions {
  prompt: string;
  sessionId: string;
  sdkSessionId?: string;
  model?: string;
  systemPrompt?: string;
  workingDirectory?: string;
  abortController?: AbortController;
  permissionMode?: string;
  files?: FileAttachment[];
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  loadEmergencyConversationHistory?: (
    reason: string,
  ) => Array<{ role: 'user' | 'assistant'; content: string }> | Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
  onSessionIdInvalidated?: () => void;
  onRuntimeStatusChange?: (status: string) => void;
}

interface CodexAttemptState {
  resumeSessionId?: string;
  sawConversationEvent: boolean;
  nonTerminalErrorMessage: string | null;
}

type CodexReasoningEffort = string;
const CODEX_EFFORT_SEPARATOR = '::effort=';
const MIN_CODEX_APP_SERVER_VERSION = '0.145.0';
const COMPACTION_COMPLETION_TIMEOUT_MS = 60_000;

function compactionCompletionTimeoutMs(): number {
  const override = Number.parseInt(process.env.NOONFLOW_CODEX_COMPACTION_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(override) && override > 0
    ? override
    : COMPACTION_COMPLETION_TIMEOUT_MS;
}

const CODEX_CLI_SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const CODEX_CLI_SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
]);

function isCodexCliSupportedImageAttachment(file: FileAttachment): boolean {
  const mime = file.type?.toLowerCase();
  if (mime && CODEX_CLI_SUPPORTED_IMAGE_MIME_TYPES.has(mime)) {
    return true;
  }

  const ext = file.filePath?.toLowerCase().split('.').pop();
  if (!ext) {
    return false;
  }

  return CODEX_CLI_SUPPORTED_IMAGE_EXTENSIONS.has(`.${ext}`);
}

function splitCodexModelAndEffort(
  model?: string,
): { model?: string; effort?: CodexReasoningEffort } {
  const normalizedModel = model?.trim();
  if (!normalizedModel) {
    return {};
  }

  const separatorIndex = normalizedModel.lastIndexOf(CODEX_EFFORT_SEPARATOR);
  if (separatorIndex > 0) {
    const baseModel = normalizedModel.slice(0, separatorIndex).trim();
    const encodedEffort = normalizedModel.slice(separatorIndex + CODEX_EFFORT_SEPARATOR.length);
    try {
      const effort = decodeURIComponent(encodedEffort).trim();
      if (baseModel && effort) return { model: baseModel, effort };
    } catch {
      // Fall through to support legacy model-effort values.
    }
  }

  const suffixMatch = normalizedModel.match(/^(.*?)-(ultra|max|xhigh|high|medium|middle|low)$/i);
  if (!suffixMatch || !suffixMatch[1]) {
    return { model: normalizedModel };
  }

  const normalizedBaseModel = suffixMatch[1].trim();
  if (!normalizedBaseModel) {
    return { model: normalizedModel };
  }

  const normalizedEffort = suffixMatch[2].toLowerCase();
  const effortMap: Record<string, CodexReasoningEffort> = {
    low: 'low',
    medium: 'medium',
    middle: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
    ultra: 'ultra',
  };

  return {
    model: normalizedBaseModel,
    effort: effortMap[normalizedEffort],
  };
}

function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function buildCodexPrompt(
  prompt: string,
  options: {
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    systemPrompt?: string;
    files?: FileAttachment[];
  } = {},
): string {
  const { history, systemPrompt, files } = options;
  const sections: string[] = [];

  if (systemPrompt?.trim()) {
    sections.push('<system_prompt>');
    sections.push(systemPrompt.trim());
    sections.push('</system_prompt>');
  }

  if (history && history.length > 0) {
    sections.push('<conversation_history>');
    for (const message of history) {
      sections.push(`${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`);
    }
    sections.push('</conversation_history>');
  }

  const filePaths = (files || [])
    .map((file) => file.filePath)
    .filter((value): value is string => Boolean(value));
  if (filePaths.length > 0) {
    sections.push('<attached_files>');
    for (const filePath of filePaths) {
      sections.push(filePath);
    }
    sections.push('</attached_files>');
  }

  sections.push(prompt);
  return sections.join('\n\n');
}

function isInvalidStreamState(error: unknown): boolean {
  return error instanceof TypeError && /Invalid state/.test(error.message);
}

function getAppServerThreadOptions(params: {
  cwd: string;
  permissionMode?: string;
  skipPermissions: boolean;
  resolvedModel?: string;
  systemPrompt?: string;
}): Record<string, unknown> {
  const {
    cwd,
    permissionMode,
    skipPermissions,
    resolvedModel,
    systemPrompt,
  } = params;
  const threadOptions: Record<string, unknown> = {
    cwd,
    approvalPolicy: skipPermissions ? 'never' : 'on-request',
    sandbox: permissionMode === 'plan'
      ? 'read-only'
      : skipPermissions
        ? 'danger-full-access'
        : 'workspace-write',
  };
  if (resolvedModel) threadOptions.model = resolvedModel;
  if (systemPrompt?.trim()) threadOptions.developerInstructions = systemPrompt.trim();
  return threadOptions;
}

function buildAppServerInput(params: {
  prompt: string;
  files?: FileAttachment[];
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  includeEmergencyContext: boolean;
}): Array<Record<string, unknown>> {
  const textReferencedFiles = (params.files ?? []).filter((file) => (
    !(file.filePath && file.type.startsWith('image/') && isCodexCliSupportedImageAttachment(file))
  ));
  const promptText = params.includeEmergencyContext
    ? buildCodexPrompt(params.prompt, {
        history: params.conversationHistory,
        files: textReferencedFiles,
      })
    : buildCodexPrompt(params.prompt, { files: textReferencedFiles });
  const input: Array<Record<string, unknown>> = [
    { type: 'text', text: promptText, text_elements: [] },
  ];
  for (const file of params.files ?? []) {
    if (file.filePath && file.type.startsWith('image/') && isCodexCliSupportedImageAttachment(file)) {
      input.push({ type: 'localImage', path: file.filePath });
    }
  }
  return input;
}

interface AppServerTokenBreakdown {
  totalTokens?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function normalizeCodexAppServerTurnUsage(value: unknown): TokenUsage {
  const usage = value && typeof value === 'object'
    ? value as AppServerTokenBreakdown
    : {};
  const cachedInput = nonNegativeNumber(usage.cachedInputTokens);
  const cacheWriteInput = nonNegativeNumber(usage.cacheWriteInputTokens);
  const nativeInput = nonNegativeNumber(usage.inputTokens);
  return {
    // Native inputTokens includes both cache subsets. The shared TokenUsage shape
    // is additive, so store only the uncached remainder here exactly once.
    input_tokens: Math.max(0, nativeInput - cachedInput - cacheWriteInput),
    output_tokens: nonNegativeNumber(usage.outputTokens),
    cache_read_input_tokens: cachedInput,
    cache_creation_input_tokens: cacheWriteInput,
  };
}

function normalizeAppServerItem(item: Record<string, unknown>): Record<string, unknown> {
  const typeMap: Record<string, string> = {
    agentMessage: 'agent_message',
    reasoning: 'reasoning',
    commandExecution: 'command_execution',
    fileChange: 'file_change',
    mcpToolCall: 'mcp_tool_call',
    contextCompaction: 'context_compaction',
  };
  const type = typeof item.type === 'string' ? typeMap[item.type] ?? item.type : '';
  if (type === 'reasoning') {
    const summary = Array.isArray(item.summary)
      ? item.summary.filter((part): part is string => typeof part === 'string')
      : [];
    const content = Array.isArray(item.content)
      ? item.content.filter((part): part is string => typeof part === 'string')
      : [];
    return { ...item, type, text: [...summary, ...content].join('\n') };
  }
  return {
    ...item,
    type,
    aggregated_output: item.aggregatedOutput,
    exit_code: item.exitCode,
  };
}

function appServerThreadId(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const thread = (result as { thread?: unknown }).thread;
  if (!thread || typeof thread !== 'object') return null;
  const id = (thread as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function isContextWindowExceededTurn(turn: unknown): boolean {
  if (!turn || typeof turn !== 'object') return false;
  const error = (turn as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;
  const info = (error as { codexErrorInfo?: unknown }).codexErrorInfo;
  const message = String((error as { message?: unknown }).message ?? '');
  return info === 'contextWindowExceeded'
    || info === 'ContextWindowExceeded'
    || /ContextWindowExceeded|context window exceeded/i.test(message);
}

function formatCodexErrorMessage(error: unknown, resolvedModel?: string): string {
  const message = error instanceof Error ? error.message : String(error || 'Codex error');
  const normalizedLimitMessage = normalizeContextLimitErrorMessage(message);
  if (normalizedLimitMessage !== message) {
    return normalizedLimitMessage;
  }
  if (resolvedModel && /403 Forbidden/.test(message)) {
    return `Configured Codex model "${resolvedModel}" was rejected by provider.\n\n${message}`;
  }
  return message;
}

export function streamCodex(options: CodexStreamOptions): ReadableStream<string> {
  const {
    prompt,
    sessionId,
    sdkSessionId,
    model,
    systemPrompt,
    workingDirectory,
    abortController,
    permissionMode,
    files,
    conversationHistory,
    loadEmergencyConversationHistory,
    onSessionIdInvalidated,
    onRuntimeStatusChange,
  } = options;

  const streamAbortController = abortController ?? new AbortController();
  let currentAppServer: CodexAppServerClient | null = null;

  return new ReadableStream<string>({
    start(controller) {
      let streamClosed = false;
      let doneEmitted = false;
      let fallbackAttempted = false;
      const reasoningById = new Map<string, string>();
      const agentMessageById = new Map<string, string>();
      const emittedAgentMessageTextById = new Map<string, string>();
      const commandOutputById = new Map<string, string>();
      const toolStarted = new Set<string>();
      let pendingFinalAgentMessage: { id: string; text: string } | null = null;
      let emittedCommentaryCount = 0;
      let emergencyConversationHistory = conversationHistory;
      const activityAdapter = new RuntimeActivityAdapter('codex', sessionId);
      const reasoningEnabled = getSetting(SETTING_KEYS.CHAT_REASONING_ENABLED) === 'true';
      setRuntimeContextState(sessionId, createUnavailableRuntimeContextState('codex'));

      const ensureEmergencyHistory = async (reason: string) => {
        if (emergencyConversationHistory?.length || !loadEmergencyConversationHistory) return;
        emergencyConversationHistory = await loadEmergencyConversationHistory(reason);
      };

      const emitEvent = (event: SSEEvent) => {
        if (streamClosed) {
          return;
        }

        try {
          controller.enqueue(formatSSE(event));
        } catch (error) {
          if (isInvalidStreamState(error)) {
            streamClosed = true;
            return;
          }
          throw error;
        }
      };

      const closeStream = () => {
        if (streamClosed) {
          return;
        }

        streamClosed = true;
        try {
          controller.close();
        } catch (error) {
          if (!isInvalidStreamState(error)) {
            throw error;
          }
        }
      };

      const flushPendingAgentMessageAsCommentary = () => {
        const pendingId = pendingFinalAgentMessage?.id;
        const text = pendingFinalAgentMessage?.text.trim();
        if (!text) {
          pendingFinalAgentMessage = null;
          return;
        }
        if (!reasoningEnabled) {
          pendingFinalAgentMessage = null;
          return;
        }

        const emittedText = pendingId ? (emittedAgentMessageTextById.get(pendingId) || '') : '';
        const commentaryDelta = emittedText ? appendCodexDelta(emittedText, text) : text;
        if (commentaryDelta.trim()) {
          emitEvent({
            type: 'reasoning',
            data: emittedCommentaryCount > 0 ? `\n\n${commentaryDelta}` : commentaryDelta,
          });
          emittedCommentaryCount += 1;
        }
        pendingFinalAgentMessage = null;
      };

      const flushPendingAgentMessageAsText = () => {
        const pendingId = pendingFinalAgentMessage?.id;
        const text = pendingFinalAgentMessage?.text.trim();
        if (!text) {
          pendingFinalAgentMessage = null;
          return;
        }
        const emittedText = pendingId ? (emittedAgentMessageTextById.get(pendingId) || '') : '';
        const delta = emittedText ? appendCodexDelta(emittedText, text) : text;
        if (delta) {
          emitEvent({ type: 'text', data: delta });
        }
        if (pendingId) {
          emittedAgentMessageTextById.set(pendingId, text);
        }
        pendingFinalAgentMessage = null;
      };

      const emitDone = () => {
        if (doneEmitted) {
          return;
        }
        doneEmitted = true;
        emitEvent({ type: 'done', data: '' });
      };

      const emitSessionFallbackNotice = () => {
        emitEvent({
          type: 'status',
          data: JSON.stringify({
            notification: true,
            title: 'Session fallback',
            message: 'Previous Codex session could not be resumed. Starting fresh conversation.',
          }),
        });
      };

      const handleThreadEvent = (
        event: {
          type: 'item.started' | 'item.updated' | 'item.completed';
          item: Record<string, unknown>;
        },
        attemptState: CodexAttemptState,
      ) => {
        attemptState.sawConversationEvent = true;

        for (const activity of activityAdapter.adapt(event)) {
          emitEvent({ type: 'activity.updated', data: JSON.stringify(activity) });
        }

        switch (event.type) {
          case 'item.started':
          case 'item.updated':
          case 'item.completed': {
            const envelope = extractCodexItemEnvelope(event);
            if (!envelope) {
              return;
            }
            const { itemId, details } = envelope;

            switch (details.type) {
              case 'agent_message': {
                const nextText = typeof details.text === 'string' ? details.text : '';
                if (!reasoningEnabled) {
                  const previous = agentMessageById.get(itemId) || '';
                  const delta = appendCodexDelta(previous, nextText);
                  agentMessageById.set(itemId, nextText);
                  if (delta) {
                    emitEvent({ type: 'text', data: delta });
                  }
                  return;
                }
                if (pendingFinalAgentMessage && pendingFinalAgentMessage.id !== itemId) {
                  flushPendingAgentMessageAsCommentary();
                }
                if (event.type === 'item.updated' || event.type === 'item.completed') {
                  if (event.type === 'item.updated') {
                    const emittedText = emittedAgentMessageTextById.get(itemId) || '';
                    const delta = appendCodexDelta(emittedText, nextText);
                    if (delta) {
                      emitEvent({ type: 'text', data: delta });
                      emittedAgentMessageTextById.set(itemId, nextText);
                    }
                  }
                  pendingFinalAgentMessage = {
                    id: itemId,
                    text: nextText,
                  };
                }
                return;
              }
              case 'reasoning': {
                if (!reasoningEnabled) {
                  return;
                }
                const nextText = typeof details.text === 'string' ? details.text : '';
                const previous = reasoningById.get(itemId) || '';
                const delta = appendCodexDelta(previous, nextText);
                reasoningById.set(itemId, nextText);
                if (delta) {
                  emitEvent({ type: 'reasoning', data: delta });
                }
                return;
              }
              case 'command_execution': {
                const command = typeof details.command === 'string' ? details.command : '';
                if (!toolStarted.has(itemId)) {
                  toolStarted.add(itemId);
                  emitEvent({
                    type: 'tool_use',
                    data: JSON.stringify({ id: itemId, name: 'exec_command', input: { command } }),
                  });
                }

                const output = typeof details.aggregated_output === 'string' ? details.aggregated_output : '';
                const previous = commandOutputById.get(itemId) || '';
                const delta = appendCodexDelta(previous, output);
                commandOutputById.set(itemId, output);
                if (delta) {
                  emitEvent({ type: 'tool_output', data: delta });
                }

                if (event.type === 'item.completed') {
                  emitEvent({
                    type: 'tool_result',
                    data: JSON.stringify({
                      tool_use_id: itemId,
                      tool_name: 'exec_command',
                      content: output || `exit code: ${details.exit_code ?? 'unknown'}`,
                      is_error: details.status === 'failed' || details.status === 'declined',
                    }),
                  });
                }
                return;
              }
              case 'file_change': {
                if (!toolStarted.has(itemId)) {
                  toolStarted.add(itemId);
                  emitEvent({
                    type: 'tool_use',
                    data: JSON.stringify({ id: itemId, name: 'apply_patch', input: { changes: details.changes } }),
                  });
                }
                if (event.type === 'item.completed') {
                  emitEvent({
                    type: 'tool_result',
                    data: JSON.stringify({
                      tool_use_id: itemId,
                      tool_name: 'apply_patch',
                      content: JSON.stringify(details.changes ?? []),
                      is_error: details.status === 'failed',
                    }),
                  });
                }
                return;
              }
              case 'mcp_tool_call': {
                if (!toolStarted.has(itemId)) {
                  toolStarted.add(itemId);
                  emitEvent({
                    type: 'tool_use',
                    data: JSON.stringify({
                      id: itemId,
                      name: typeof details.tool === 'string' ? details.tool : 'mcp_tool',
                      input: { server: details.server, arguments: details.arguments },
                    }),
                  });
                }
                if (event.type === 'item.completed') {
                  emitEvent({
                    type: 'tool_result',
                    data: JSON.stringify({
                      tool_use_id: itemId,
                      tool_name: typeof details.tool === 'string' ? details.tool : 'mcp_tool',
                      content: JSON.stringify(details.result ?? details.error ?? ''),
                      is_error: details.status === 'failed',
                    }),
                  });
                }
                return;
              }
              case 'todo_list':
                emitEvent({
                  type: 'task_update',
                  data: JSON.stringify({ session_id: sessionId, todos: details.items ?? [] }),
                });
                return;
              case 'error':
                attemptState.nonTerminalErrorMessage = typeof details.message === 'string'
                  ? normalizeContextLimitErrorMessage(details.message)
                  : 'Codex item error';
                console.warn('[codex-client] non-terminal item error', {
                  message: attemptState.nonTerminalErrorMessage,
                });
                return;
              default:
                return;
            }
          }
          default:
            return;
        }
      };

      const finalizeAttempt = () => {
        onRuntimeStatusChange?.('idle');
        closeStream();
      };

      const handleAttemptFailure = async (
        error: unknown,
        attemptState: CodexAttemptState,
        resolvedModel?: string,
      ) => {
        const canFallback = Boolean(
          attemptState.resumeSessionId
          && !fallbackAttempted
          && !doneEmitted
          && !attemptState.sawConversationEvent
        );

        if (canFallback) {
          fallbackAttempted = true;
          onSessionIdInvalidated?.();
          await ensureEmergencyHistory(
            error instanceof Error ? `native_resume_failed:${error.message}` : 'native_resume_failed',
          );
          // Reset accumulator state so the fresh attempt starts clean
          reasoningById.clear();
          agentMessageById.clear();
          emittedAgentMessageTextById.clear();
          commandOutputById.clear();
          toolStarted.clear();
          pendingFinalAgentMessage = null;
          emittedCommentaryCount = 0;
          emitSessionFallbackNotice();
          await runAttempt(undefined);
          return;
        }

        if (!doneEmitted) {
          flushPendingAgentMessageAsCommentary();
          emitEvent({
            type: 'error',
            data: formatCodexErrorMessage(error, resolvedModel),
          });
          emitDone();
        }
        finalizeAttempt();
      };

      const runAppServerAttempt = async (
        params: {
          resumeSessionId?: string;
          binary: string;
          cwd: string;
          settings: CodexRuntimeSettings;
          skipPermissions: boolean;
          resolvedModel?: string;
          statusModel?: string;
          resolvedReasoningEffort?: CodexReasoningEffort;
        },
      ) => {
        const {
          resumeSessionId,
          binary,
          cwd,
          settings,
          skipPermissions,
          resolvedModel,
          statusModel,
          resolvedReasoningEffort,
        } = params;
        const attemptState: CodexAttemptState = {
          resumeSessionId,
          sawConversationEvent: false,
          nonTerminalErrorMessage: null,
        };
        const completedTurns = new Map<string, Record<string, unknown>>();
        const emittedThreadIds = new Set<string>();
        let expectedTurnId: string | null = null;
        let resolveTurn: ((turn: Record<string, unknown>) => void) | null = null;
        let rejectTurn: ((error: Error) => void) | null = null;
        let activeThreadId: string | null = null;
        let latestTurnUsage: TokenUsage | null = null;
        let appServer: CodexAppServerClient | null = null;
        let abortHandler: (() => void) | null = null;
        let resolveCompaction: (() => void) | null = null;
        let rejectCompaction: ((error: Error) => void) | null = null;
        let compactionTimer: ReturnType<typeof setTimeout> | null = null;
        let recoveryCompactionAttempted = false;
        let recoveryCompactionCompleted = false;
        let compactionCycleActive = false;
        let awaitingPostCompactionUsageTurnId: string | null = null;
        const contextUsageByTurnId = new Map<string, ReturnType<typeof buildNativeTokenState>>();
        const contextUsageBeforeTurnId = new Map<string, ReturnType<typeof buildNativeTokenState>>();

        const emitThreadStarted = (threadId: string) => {
          if (emittedThreadIds.has(threadId)) return;
          emittedThreadIds.add(threadId);
          const statusEvent = buildCodexThreadStartedStatusEvent(
            { type: 'thread.started', thread_id: threadId },
            statusModel || resolvedModel,
          );
          if (statusEvent) emitEvent(statusEvent);
        };

        const completeTurn = (turn: Record<string, unknown>) => {
          const turnId = typeof turn.id === 'string' ? turn.id : '';
          if (!turnId) return;
          if (turnId === expectedTurnId && resolveTurn) {
            const resolve = resolveTurn;
            resolveTurn = null;
            rejectTurn = null;
            expectedTurnId = null;
            resolve(turn);
            return;
          }
          completedTurns.set(turnId, turn);
        };

        const waitForTurn = (turnId: string): Promise<Record<string, unknown>> => {
          const completed = completedTurns.get(turnId);
          if (completed) {
            completedTurns.delete(turnId);
            return Promise.resolve(completed);
          }
          expectedTurnId = turnId;
          return new Promise<Record<string, unknown>>((resolve, reject) => {
            resolveTurn = resolve;
            rejectTurn = reject;
          });
        };

        const handleNotification = (notification: AppServerNotification) => {
          const notificationParams = notification.params ?? {};
          switch (notification.method) {
            case 'thread/started': {
              const thread = notificationParams.thread;
              if (thread && typeof thread === 'object') {
                const threadId = (thread as { id?: unknown }).id;
                if (typeof threadId === 'string') emitThreadStarted(threadId);
              }
              return;
            }
            case 'turn/started':
              attemptState.sawConversationEvent = true;
              emitEvent({ type: 'status', data: 'Codex is working...' });
              return;
            case 'turn/completed': {
              const turn = notificationParams.turn;
              if (turn && typeof turn === 'object') completeTurn(turn as Record<string, unknown>);
              return;
            }
            case 'thread/tokenUsage/updated': {
              const usageTurnId = typeof notificationParams.turnId === 'string'
                ? notificationParams.turnId
                : null;
              const tokenUsage = notificationParams.tokenUsage as {
                total?: AppServerTokenBreakdown;
                last?: AppServerTokenBreakdown;
                modelContextWindow?: number | null;
              } | undefined;
              if (!tokenUsage?.last) return;
              latestTurnUsage = normalizeCodexAppServerTurnUsage(tokenUsage.last);
              const currentContext = buildNativeTokenState(
                // App-server `total` is cumulative thread usage. `last.totalTokens`
                // is the native token count for the latest model-visible context.
                nonNegativeNumber(tokenUsage.last.totalTokens),
                typeof tokenUsage.modelContextWindow === 'number'
                  ? tokenUsage.modelContextWindow
                  : null,
              );
              if (usageTurnId) {
                const previousContext = getRuntimeContextState(sessionId)?.currentContext;
                if (previousContext && !contextUsageBeforeTurnId.has(usageTurnId)) {
                  contextUsageBeforeTurnId.set(usageTurnId, previousContext);
                }
                contextUsageByTurnId.set(usageTurnId, currentContext);
              }
              const isPostCompactionUsage = Boolean(
                usageTurnId
                && awaitingPostCompactionUsageTurnId === usageTurnId,
              );
              const stateBeforeUsageUpdate = getRuntimeContextState(sessionId);
              const completedCompaction = isPostCompactionUsage
                && stateBeforeUsageUpdate?.compaction.status === 'completed'
                ? stateBeforeUsageUpdate.compaction
                : null;
              updateRuntimeContextState(sessionId, 'codex', {
                currentContext,
                lastTurnUsage: latestTurnUsage,
                source: 'native',
                ...(completedCompaction
                  ? { compaction: { ...completedCompaction, postTokens: currentContext.usedTokens } }
                  : {}),
              });
              if (isPostCompactionUsage && usageTurnId) {
                awaitingPostCompactionUsageTurnId = null;
                contextUsageByTurnId.delete(usageTurnId);
              }
              return;
            }
            case 'item/agentMessage/delta': {
              const itemId = typeof notificationParams.itemId === 'string' ? notificationParams.itemId : '';
              const delta = typeof notificationParams.delta === 'string' ? notificationParams.delta : '';
              if (!itemId || !delta) return;
              const next = `${agentMessageById.get(itemId) ?? ''}${delta}`;
              agentMessageById.set(itemId, next);
              emittedAgentMessageTextById.set(itemId, next);
              emitEvent({ type: 'text', data: delta });
              return;
            }
            case 'item/reasoning/summaryTextDelta':
            case 'item/reasoning/textDelta': {
              if (!reasoningEnabled) return;
              const itemId = typeof notificationParams.itemId === 'string' ? notificationParams.itemId : '';
              const delta = typeof notificationParams.delta === 'string' ? notificationParams.delta : '';
              if (!itemId || !delta) return;
              reasoningById.set(itemId, `${reasoningById.get(itemId) ?? ''}${delta}`);
              emitEvent({ type: 'reasoning', data: delta });
              return;
            }
            case 'item/commandExecution/outputDelta': {
              const itemId = typeof notificationParams.itemId === 'string' ? notificationParams.itemId : '';
              const delta = typeof notificationParams.delta === 'string' ? notificationParams.delta : '';
              if (!itemId || !delta) return;
              commandOutputById.set(itemId, `${commandOutputById.get(itemId) ?? ''}${delta}`);
              emitEvent({ type: 'tool_output', data: delta });
              return;
            }
            case 'item/started':
            case 'item/completed': {
              const item = notificationParams.item;
              if (!item || typeof item !== 'object') return;
              const rawItem = item as Record<string, unknown>;
              if (rawItem.type === 'contextCompaction') {
                const compactionTurnId = typeof notificationParams.turnId === 'string'
                  ? notificationParams.turnId
                  : null;
                if (notification.method === 'item/started') {
                  const previousState = getRuntimeContextState(sessionId);
                  const activeCompaction = compactionCycleActive
                    && previousState?.compaction.status === 'compacting'
                    ? previousState.compaction
                    : null;
                  compactionCycleActive = true;
                  const nativeStartedAt = typeof notificationParams.startedAtMs === 'number'
                    && Number.isFinite(notificationParams.startedAtMs)
                    ? notificationParams.startedAtMs
                    : Date.now();
                  updateRuntimeContextState(sessionId, 'codex', {
                    compaction: {
                      status: 'compacting',
                      trigger: recoveryCompactionAttempted ? 'recovery' : 'auto',
                      startedAt: nativeStartedAt,
                      completedAt: null,
                      preTokens: activeCompaction
                        ? activeCompaction.preTokens
                        : compactionTurnId
                          ? contextUsageBeforeTurnId.get(compactionTurnId)?.usedTokens
                            ?? previousState?.currentContext?.usedTokens
                            ?? null
                          : previousState?.currentContext?.usedTokens ?? null,
                      postTokens: null,
                      postTokensEstimated: false,
                      error: null,
                    },
                  });
                  emitEvent({
                    type: 'status',
                    data: JSON.stringify({
                      notification: true,
                      title: '正在压缩上下文',
                      message: 'Codex 正在执行原生上下文压缩。',
                    }),
                  });
                } else {
                  const nativeCompletedAt = typeof notificationParams.completedAtMs === 'number'
                    && Number.isFinite(notificationParams.completedAtMs)
                    ? notificationParams.completedAtMs
                    : Date.now();
                  const cachedPostCompactionUsage = compactionTurnId
                    ? contextUsageByTurnId.get(compactionTurnId)
                    : undefined;
                  const previousState = getRuntimeContextState(sessionId);
                  const activeCompaction = compactionCycleActive
                    && previousState?.compaction.status === 'compacting'
                    ? previousState.compaction
                    : null;
                  updateRuntimeContextState(sessionId, 'codex', {
                    compaction: {
                      status: 'completed',
                      trigger: recoveryCompactionAttempted ? 'recovery' : 'auto',
                      startedAt: activeCompaction?.startedAt ?? nativeCompletedAt,
                      preTokens: activeCompaction?.preTokens ?? null,
                      postTokens: cachedPostCompactionUsage?.usedTokens ?? null,
                      postTokensEstimated: false,
                      completedAt: nativeCompletedAt,
                      error: null,
                    },
                  });
                  compactionCycleActive = false;
                  if (recoveryCompactionAttempted) recoveryCompactionCompleted = true;
                  awaitingPostCompactionUsageTurnId = cachedPostCompactionUsage
                    ? null
                    : compactionTurnId;
                  if (cachedPostCompactionUsage && compactionTurnId) {
                    contextUsageByTurnId.delete(compactionTurnId);
                  }
                  if (compactionTurnId) contextUsageBeforeTurnId.delete(compactionTurnId);
                  emitEvent({
                    type: 'status',
                    data: JSON.stringify({
                      notification: true,
                      title: '上下文压缩完成',
                      message: 'Codex 原生上下文压缩已完成。',
                    }),
                  });
                  const resolve = resolveCompaction;
                  resolveCompaction = null;
                  rejectCompaction = null;
                  if (compactionTimer) clearTimeout(compactionTimer);
                  compactionTimer = null;
                  resolve?.();
                }
                return;
              }
              handleThreadEvent({
                type: notification.method === 'item/started' ? 'item.started' : 'item.completed',
                item: { ...rawItem, details: normalizeAppServerItem(rawItem) },
              }, attemptState);
              return;
            }
            case 'thread/compacted':
              // Deprecated protocol notification: never proves compaction completion.
              return;
            case 'error': {
              const error = notificationParams.error;
              attemptState.nonTerminalErrorMessage = error && typeof error === 'object' && 'message' in error
                ? String((error as { message?: unknown }).message ?? 'Codex app-server error')
                : String(notificationParams.message ?? 'Codex app-server error');
              return;
            }
            default:
              return;
          }
        };

        const handleServerRequest = async (request: AppServerRequest): Promise<unknown> => {
          const supported = request.method === 'item/commandExecution/requestApproval'
            || request.method === 'item/fileChange/requestApproval';
          if (!supported) throw new Error(`Unsupported Codex app-server request: ${request.method}`);
          const requestParams = request.params ?? {};
          const permissionRequestId = `codex-${String(request.id)}-${Date.now()}`;
          const itemId = typeof requestParams.itemId === 'string'
            ? requestParams.itemId
            : permissionRequestId;
          const commandRequest = request.method === 'item/commandExecution/requestApproval';
          const toolName = commandRequest ? 'exec_command' : 'apply_patch';
          const toolInput = commandRequest
            ? { command: requestParams.command, cwd: requestParams.cwd }
            : { grantRoot: requestParams.grantRoot, reason: requestParams.reason };
          emitEvent({
            type: 'permission_request',
            data: JSON.stringify({
              permissionRequestId,
              toolName,
              toolInput,
              decisionReason: typeof requestParams.reason === 'string' ? requestParams.reason : undefined,
              toolUseId: itemId,
            }),
          });
          onRuntimeStatusChange?.('waiting_permission');
          const result = await registerPendingPermission(
            permissionRequestId,
            toolInput,
            streamAbortController.signal,
          );
          onRuntimeStatusChange?.('running');
          return { decision: result.behavior === 'allow' ? 'accept' : 'decline' };
        };

        try {
          const launch = resolveCodexAppServerLaunch(binary, settings.env);
          appServer = new CodexAppServerClient({
            executablePath: launch.executablePath,
            cwd,
            env: launch.env,
            onNotification: handleNotification,
            onServerRequest: handleServerRequest,
            onFatalError: (error) => {
              rejectTurn?.(error);
              rejectCompaction?.(error);
            },
          });
          currentAppServer = appServer;
          await appServer.start();

          abortHandler = () => {
            const stopped = new Error('Codex turn stopped by user');
            const finish = () => {
              rejectTurn?.(stopped);
              rejectCompaction?.(stopped);
              appServer?.stop();
            };
            if (activeThreadId && expectedTurnId) {
              void appServer?.request('turn/interrupt', {
                threadId: activeThreadId,
                turnId: expectedTurnId,
              }).then(finish, finish);
            } else {
              finish();
            }
          };
          streamAbortController.signal.addEventListener('abort', abortHandler, { once: true });
          if (streamAbortController.signal.aborted) {
            abortHandler();
            throw new Error('Codex turn stopped by user');
          }

          const threadOptions = getAppServerThreadOptions({
            cwd,
            permissionMode,
            skipPermissions,
            resolvedModel,
            systemPrompt: resumeSessionId ? undefined : systemPrompt,
          });
          const threadResult = resumeSessionId
            ? await appServer.request('thread/resume', { threadId: resumeSessionId, ...threadOptions })
            : await appServer.request('thread/start', threadOptions);
          activeThreadId = appServerThreadId(threadResult);
          if (!activeThreadId) throw new Error('Codex app-server did not return a thread id');
          emitThreadStarted(activeThreadId);

          const emergencyHistoryActive = !resumeSessionId && Boolean(emergencyConversationHistory?.length);
          const input = buildAppServerInput({
            prompt,
            files,
            conversationHistory: emergencyConversationHistory,
            includeEmergencyContext: emergencyHistoryActive,
          });
          const startTurn = async (): Promise<Record<string, unknown>> => {
            const response = await appServer!.request<{ turn?: { id?: string } }>('turn/start', {
              threadId: activeThreadId,
              input,
              cwd,
              ...(resolvedModel ? { model: resolvedModel } : {}),
              ...(resolvedReasoningEffort ? { effort: resolvedReasoningEffort } : {}),
            });
            const turnId = response.turn?.id;
            if (!turnId) throw new Error('Codex app-server did not return a turn id');
            return waitForTurn(turnId);
          };

          let turn = await startTurn();
          if (isContextWindowExceededTurn(turn)) {
            recoveryCompactionAttempted = true;
            recoveryCompactionCompleted = false;
            compactionCycleActive = true;
            awaitingPostCompactionUsageTurnId = null;
            const priorState = getRuntimeContextState(sessionId);
            updateRuntimeContextState(sessionId, 'codex', {
              compaction: {
                status: 'compacting',
                trigger: 'recovery',
                startedAt: Date.now(),
                completedAt: null,
                preTokens: priorState?.currentContext?.usedTokens ?? null,
                postTokens: null,
                postTokensEstimated: false,
                error: null,
              },
            });
            const compactCompleted = new Promise<void>((resolve, reject) => {
              resolveCompaction = resolve;
              rejectCompaction = reject;
              compactionTimer = setTimeout(() => {
                resolveCompaction = null;
                rejectCompaction = null;
                compactionTimer = null;
                reject(new Error('Codex native compaction timed out before contextCompaction completed'));
              }, compactionCompletionTimeoutMs());
              compactionTimer.unref?.();
            });
            let compactRpcError: unknown = null;
            let compactRpcErrorReported = false;
            const reportCompactRpcError = () => {
              if (compactRpcErrorReported || !compactRpcError) return;
              compactRpcErrorReported = true;
              console.warn(
                '[codex-client] Ignoring compact RPC error after authoritative contextCompaction completion:',
                compactRpcError,
              );
            };
            void appServer.request('thread/compact/start', { threadId: activeThreadId })
              .catch((error: unknown) => {
                compactRpcError = error;
                const stoppedDuringCleanup = error instanceof Error
                  && error.message === 'Codex app-server stopped';
                if (recoveryCompactionCompleted && !stoppedDuringCleanup) {
                  reportCompactRpcError();
                }
              });
            try {
              await compactCompleted;
            } catch (completionError) {
              if (!compactRpcError) throw completionError;
              const completionMessage = completionError instanceof Error
                ? completionError.message
                : String(completionError);
              const rpcMessage = compactRpcError instanceof Error
                ? compactRpcError.message
                : String(compactRpcError);
              throw new Error(`${completionMessage}; compact RPC also failed: ${rpcMessage}`);
            }
            reportCompactRpcError();
            turn = await startTurn();
          }

          const turnStatus = typeof turn.status === 'string' ? turn.status : 'failed';
          if (turnStatus !== 'completed') {
            const error = turn.error && typeof turn.error === 'object'
              ? String((turn.error as { message?: unknown }).message ?? `Codex turn ${turnStatus}`)
              : `Codex turn ${turnStatus}`;
            if (recoveryCompactionAttempted && isContextWindowExceededTurn(turn)) {
              throw new Error(`ContextWindowExceeded after native compact and one retry: ${error}`);
            }
            throw new Error(error);
          }

          flushPendingAgentMessageAsText();
          emitEvent({
            type: 'result',
            data: JSON.stringify({ usage: latestTurnUsage, session_id: activeThreadId }),
          });
          emitDone();
          finalizeAttempt();
        } catch (error) {
          if (recoveryCompactionAttempted && !recoveryCompactionCompleted) {
            const completedAt = Date.now();
            const previousCompaction = getRuntimeContextState(sessionId)?.compaction;
            const activeCompaction = previousCompaction?.status === 'compacting'
              ? previousCompaction
              : null;
            updateRuntimeContextState(sessionId, 'codex', {
              compaction: {
                status: 'failed',
                trigger: activeCompaction?.trigger ?? 'recovery',
                preTokens: activeCompaction?.preTokens ?? null,
                postTokens: null,
                postTokensEstimated: false,
                startedAt: activeCompaction?.startedAt ?? completedAt,
                completedAt,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
          appServer?.stop();
          if (currentAppServer === appServer) currentAppServer = null;
          await handleAttemptFailure(
            attemptState.nonTerminalErrorMessage
              ? new Error(attemptState.nonTerminalErrorMessage)
              : error,
            attemptState,
            resolvedModel,
          );
        } finally {
          if (abortHandler) streamAbortController.signal.removeEventListener('abort', abortHandler);
          if (compactionTimer) clearTimeout(compactionTimer);
          resolveCompaction = null;
          rejectCompaction = null;
          compactionTimer = null;
          appServer?.stop();
          if (currentAppServer === appServer) currentAppServer = null;
        }
      };

      const runAttempt = async (resumeSessionId?: string) => {
        if (permissionMode === 'default') {
          emitEvent({
            type: 'error',
            data: 'Codex does not support ask mode without tool access. Switch to Claude Code or use code/plan mode.',
          });
          emitDone();
          closeStream();
          return;
        }

        const binary = findCodexBinary();
        if (!binary) {
          emitEvent({
            type: 'error',
            data: 'Codex CLI is not installed. Install it with `npm install -g @openai/codex`, then run `codex login` and restart NoonFlow.',
          });
          emitDone();
          closeStream();
          return;
        }

        const cwd = workingDirectory || os.homedir();
        const resolvedModelCandidate = resolvePreferredCodexModel(model);
        const {
          model: resolvedModel,
          effort: resolvedReasoningEffort,
        } = splitCodexModelAndEffort(resolvedModelCandidate);
        const statusModel = resolvedModelCandidate || resolvedModel;
        const effectiveReasoningEffort = reasoningEnabled ? resolvedReasoningEffort : undefined;
        const codexImageFiles = (files || [])
          .filter((file) => file.type.startsWith('image/') && file.filePath);
        const imagePaths = codexImageFiles
          .filter((file) => isCodexCliSupportedImageAttachment(file))
          .map((file) => file.filePath as string);
        const skippedUnsupportedImages = codexImageFiles.length - imagePaths.length;
        const settings = await buildCodexRuntimeSettings();
        const skipPermissions = isDangerouslySkipPermissionsEnabled(getSetting('dangerously_skip_permissions'));

        const cliVersion = await getCodexVersion(binary);
        if (!isCliVersionAtLeast(cliVersion, MIN_CODEX_APP_SERVER_VERSION)) {
          emitEvent({
            type: 'error',
            data: `Codex CLI ${cliVersion || 'version unknown'} is too old for NoonFlow app-server. Install Codex CLI ${MIN_CODEX_APP_SERVER_VERSION} or newer, then restart NoonFlow.`,
          });
          emitDone();
          closeStream();
          return;
        }

        console.info('[codex-client] model resolution', {
          codexBackend: 'app-server',
          inputModel: model,
          resolvedModelCandidate,
          resolvedModel,
          resolvedReasoningEffort,
          effectiveReasoningEffort,
        });

        onRuntimeStatusChange?.('running');

        if (skippedUnsupportedImages > 0) {
          emitEvent({
            type: 'status',
            data: `${skippedUnsupportedImages} image attachment(s) use unsupported formats for Codex vision, attached as files instead.`,
          });
        }

        await runAppServerAttempt({
          resumeSessionId,
          binary,
          cwd,
          settings,
          skipPermissions,
          resolvedModel,
          statusModel,
          resolvedReasoningEffort: effectiveReasoningEffort,
        });
      };

      void runAttempt(sdkSessionId);
    },

    cancel() {
      currentAppServer?.stop();
      currentAppServer = null;
      streamAbortController.abort();
    },
  });
}
