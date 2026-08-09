import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'os';
import path from 'node:path';
import { getExpandedPath, findCodexBinary } from './platform';
import { getShellEnvironment } from './environment';
import { CODEX_AUTH_MODE_KEY, inferAssistantAuthMode } from './assistant-auth';
import { getSetting } from './db';
import { isDangerouslySkipPermissionsEnabled } from './assistant-permissions';
import { resolvePreferredCodexModel } from './codex-model';
import { getCodexBackend } from './codex-backend';
import {
  appendCodexDelta,
  buildCodexThreadStartedStatusEvent,
  buildCodexTurnCompletedResultEvent,
  extractCodexItemEnvelope,
  isCodexConversationEventType,
} from './codex/event-mapper';
import { buildLegacyCodexArgs, type CodexCliReasoningEffort } from './codex/legacy-cli';
import { normalizeContextLimitErrorMessage } from './context-budget';
import type { FileAttachment, SSEEvent } from '@/types';
import { SETTING_KEYS } from '@/types';

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject;

interface CodexConfigObject {
  [key: string]: CodexConfigValue;
}

interface CodexOptions {
  codexPathOverride?: string;
  baseUrl?: string;
  apiKey?: string;
  config?: CodexConfigObject;
  env?: Record<string, string>;
}

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

interface CodexSdkLaunchConfig {
  executablePath: string;
  env: NodeJS.ProcessEnv;
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
    const requireFromCodex = createRequire(codexEntrypoint);
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

function resolveCodexSdkLaunch(
  binary: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  architecture: NodeJS.Architecture = process.arch,
): CodexSdkLaunchConfig {
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

export function __resolveCodexSdkLaunchForTests(
  binary: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): CodexSdkLaunchConfig {
  return resolveCodexSdkLaunch(binary, env, platform, architecture);
}

type CodexApprovalMode = 'never' | 'on-request' | 'on-failure' | 'untrusted';
type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
type ModelReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

interface ThreadOptions {
  model?: string;
  sandboxMode?: CodexSandboxMode;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?: ModelReasoningEffort;
  networkAccessEnabled?: boolean;
  approvalPolicy?: CodexApprovalMode;
  additionalDirectories?: string[];
}

type UserInput =
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string };

type ThreadEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed'; usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number } }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'item.started' | 'item.updated' | 'item.completed'; item: Record<string, unknown> }
  | { type: 'error'; message: string };

interface CodexThreadHandle {
  runStreamed(
    input: string | UserInput[],
    options?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
}

interface CodexClientInstance {
  startThread(options?: ThreadOptions): CodexThreadHandle;
  resumeThread(id: string, options?: ThreadOptions): CodexThreadHandle;
}

let codexCtorPromise: Promise<new (options?: CodexOptions) => CodexClientInstance> | null = null;

export function __setCodexCtorForTests(
  ctor: (new (options?: CodexOptions) => CodexClientInstance) | null,
): void {
  codexCtorPromise = ctor ? Promise.resolve(ctor) : null;
}

async function loadCodexCtor(): Promise<new (options?: CodexOptions) => CodexClientInstance> {
  if (!codexCtorPromise) {
    codexCtorPromise = import('@openai/codex-sdk').then(
      (module) => module.Codex as new (options?: CodexOptions) => CodexClientInstance,
    );
  }
  return codexCtorPromise;
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
  onSessionIdInvalidated?: () => void;
  onRuntimeStatusChange?: (status: string) => void;
}

interface CodexClientSettings {
  env: NodeJS.ProcessEnv;
  apiKey?: string;
  baseUrl?: string;
}

interface CodexSdkRuntimeConfig {
  clientOptions: CodexOptions;
  threadOptions: ThreadOptions;
  input: string | UserInput[];
}

interface CodexAttemptState {
  resumeSessionId?: string;
  sawConversationEvent: boolean;
  deferredErrorMessage: string | null;
  nonTerminalErrorMessage: string | null;
}

interface CodexThreadEvent {
  type: string;
  [key: string]: unknown;
}

type CodexReasoningEffort = CodexCliReasoningEffort;

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

  const suffixMatch = normalizedModel.match(/^(.*?)-(xhigh|high|medium|middle|low)$/i);
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

async function buildCodexClientSettings(): Promise<CodexClientSettings> {
  const shellEnv = await getShellEnvironment();
  // Use shell env as base, but ensure NODE_ENV is always set from process.env
  const env: NodeJS.ProcessEnv = {
    ...shellEnv,
    HOME: shellEnv.HOME || os.homedir(),
    PATH: shellEnv.PATH || getExpandedPath(),
    // NODE_ENV is required by ProcessEnv type, always use process.env value
    NODE_ENV: process.env.NODE_ENV as 'development' | 'production' | 'test',
  };

  const apiKey = getSetting(SETTING_KEYS.CODEX_AUTH_TOKEN) || undefined;
  const baseUrl = getSetting(SETTING_KEYS.CODEX_BASE_URL) || undefined;
  const codexExtraEnv = getSetting(SETTING_KEYS.CODEX_EXTRA_ENV);
  const authMode = inferAssistantAuthMode({
    storedMode: getSetting(CODEX_AUTH_MODE_KEY),
    storedToken: apiKey,
    storedBaseUrl: baseUrl,
    envToken: env.OPENAI_API_KEY || env.CODEX_AUTH_TOKEN || env.CODEX_API_KEY,
    envBaseUrl: env.OPENAI_BASE_URL,
  });

  if (authMode === 'login') {
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    delete env.CODEX_AUTH_TOKEN;
    delete env.OPENAI_BASE_URL;
  } else {
    if (apiKey) {
      env.OPENAI_API_KEY = apiKey;
      env.CODEX_API_KEY = apiKey;
      env.CODEX_AUTH_TOKEN = apiKey;
    }
    if (baseUrl) {
      env.OPENAI_BASE_URL = baseUrl;
    }
  }
  if (codexExtraEnv) {
    try {
      const parsed = JSON.parse(codexExtraEnv) as Record<string, string>;
      for (const [key, value] of Object.entries(parsed)) {
        if (value) {
          env[key] = value;
        }
      }
    } catch {
      // ignore invalid extra env payloads
    }
  }

  return {
    env,
    apiKey: authMode === 'api_key' ? apiKey : undefined,
    baseUrl: authMode === 'api_key' ? baseUrl : undefined,
  };
}

function safeJsonParse(value: string): CodexThreadEvent | null {
  try {
    return JSON.parse(value) as CodexThreadEvent;
  } catch {
    return null;
  }
}

function isInvalidStreamState(error: unknown): boolean {
  return error instanceof TypeError && /Invalid state/.test(error.message);
}

function terminateCodexProcess(child: ChildProcessWithoutNullStreams) {
  if (child.killed) {
    return;
  }

  if (process.platform === 'win32') {
    child.kill('SIGTERM');
    return;
  }

  try {
    process.kill(-child.pid!, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }

  setTimeout(() => {
    if (child.exitCode !== null || child.killed) {
      return;
    }
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, 1500);
}

function getSdkThreadOptions(params: {
  cwd: string;
  permissionMode?: string;
  skipPermissions: boolean;
  resolvedModel?: string;
  resolvedReasoningEffort?: CodexReasoningEffort;
}): ThreadOptions {
  const {
    cwd,
    permissionMode,
    skipPermissions,
    resolvedModel,
    resolvedReasoningEffort,
  } = params;
  const threadOptions: ThreadOptions = {
    workingDirectory: cwd,
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
  };

  if (resolvedModel) {
    threadOptions.model = resolvedModel;
  }
  if (resolvedReasoningEffort) {
    threadOptions.modelReasoningEffort = resolvedReasoningEffort as ModelReasoningEffort;
  }

  if (permissionMode === 'plan') {
    threadOptions.sandboxMode = 'read-only';
    threadOptions.networkAccessEnabled = false;
    return threadOptions;
  }

  if (skipPermissions) {
    threadOptions.sandboxMode = 'danger-full-access';
    return threadOptions;
  }

  threadOptions.sandboxMode = 'workspace-write';
  threadOptions.networkAccessEnabled = true;
  return threadOptions;
}

function buildSdkRuntimeConfig(params: {
  binary: string;
  settings: CodexClientSettings;
  cwd: string;
  permissionMode?: string;
  skipPermissions: boolean;
  resolvedModel?: string;
  resolvedReasoningEffort?: CodexReasoningEffort;
  prompt: string;
  systemPrompt?: string;
  files?: FileAttachment[];
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  imagePaths: string[];
  resumeSessionId?: string;
}): CodexSdkRuntimeConfig {
  const {
    binary,
    settings,
    cwd,
    permissionMode,
    skipPermissions,
    resolvedModel,
    resolvedReasoningEffort,
    prompt,
    systemPrompt,
    files,
    conversationHistory,
    imagePaths,
    resumeSessionId,
  } = params;

  const promptText = resumeSessionId
    ? buildCodexPrompt(prompt, { files })
    : buildCodexPrompt(prompt, {
        history: conversationHistory,
        systemPrompt,
        files,
      });

  const input = imagePaths.length > 0
    ? [
        { type: 'text', text: promptText } satisfies UserInput,
        ...imagePaths.map((path) => ({ type: 'local_image', path }) satisfies UserInput),
      ]
    : promptText;

  const clientOptions: CodexOptions = {
    env: settings.env as Record<string, string>,
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
  };

  clientOptions.codexPathOverride = binary;

  return {
    clientOptions,
    threadOptions: getSdkThreadOptions({
      cwd,
      permissionMode,
      skipPermissions,
      resolvedModel,
      resolvedReasoningEffort,
    }),
    input,
  };
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
    onSessionIdInvalidated,
    onRuntimeStatusChange,
  } = options;

  const streamAbortController = abortController ?? new AbortController();
  let currentChild: ChildProcessWithoutNullStreams | null = null;

  return new ReadableStream<string>({
    start(controller) {
      let streamClosed = false;
      let doneEmitted = false;
      let fallbackAttempted = false;
      let currentAbortHandler: (() => void) | null = null;
      const reasoningById = new Map<string, string>();
      const agentMessageById = new Map<string, string>();
      const emittedAgentMessageTextById = new Map<string, string>();
      const commandOutputById = new Map<string, string>();
      const toolStarted = new Set<string>();
      let pendingFinalAgentMessage: { id: string; text: string } | null = null;
      let emittedCommentaryCount = 0;
      const reasoningEnabled = getSetting(SETTING_KEYS.CHAT_REASONING_ENABLED) === 'true';

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
        event: ThreadEvent | CodexThreadEvent,
        attemptState: CodexAttemptState,
        resolvedModel?: string,
        statusModel?: string,
      ) => {
        if (isCodexConversationEventType(event.type)) {
          attemptState.sawConversationEvent = true;
        }

        switch (event.type) {
          case 'thread.started': {
            const statusEvent = buildCodexThreadStartedStatusEvent(event, statusModel || resolvedModel);
            if (statusEvent) {
              emitEvent(statusEvent);
            }
            return;
          }
          case 'turn.started':
            emitEvent({ type: 'status', data: 'Codex is working...' });
            return;
          case 'turn.completed':
            flushPendingAgentMessageAsText();
            {
              const resultEvent = buildCodexTurnCompletedResultEvent(event);
              if (resultEvent) {
                emitEvent(resultEvent);
              }
            }
            emitDone();
            return;
          case 'turn.failed':
            flushPendingAgentMessageAsCommentary();
            emitEvent({
              type: 'error',
              data: (event.error && typeof event.error === 'object' && 'message' in event.error)
                ? normalizeContextLimitErrorMessage(String(event.error.message))
                : 'Codex turn failed',
            });
            emitDone();
            return;
          case 'error':
            if (attemptState.resumeSessionId && !attemptState.sawConversationEvent) {
              attemptState.deferredErrorMessage = typeof event.message === 'string'
                ? event.message
                : 'Codex error';
              return;
            }
            flushPendingAgentMessageAsCommentary();
            emitEvent({
              type: 'error',
              data: typeof event.message === 'string'
                ? normalizeContextLimitErrorMessage(event.message)
                : 'Codex error',
            });
            emitDone();
            return;
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
            data: attemptState.deferredErrorMessage || formatCodexErrorMessage(error, resolvedModel),
          });
          emitDone();
        }
        finalizeAttempt();
      };

      const maybeHandleDeferredResumeFailure = async (
        attemptState: CodexAttemptState,
        resolvedModel?: string,
      ): Promise<boolean> => {
        if (!attemptState.resumeSessionId || attemptState.sawConversationEvent || !attemptState.deferredErrorMessage) {
          return false;
        }

        await handleAttemptFailure(
          new Error(attemptState.deferredErrorMessage),
          attemptState,
          resolvedModel,
        );
        return true;
      };

      const runLegacyAttempt = (
        params: {
          resumeSessionId?: string;
          binary: string;
          cwd: string;
          env: NodeJS.ProcessEnv;
          skipPermissions: boolean;
          resolvedModel?: string;
          statusModel?: string;
          resolvedReasoningEffort?: CodexReasoningEffort;
          imagePaths: string[];
        },
      ) => {
        const {
          resumeSessionId,
          binary,
          cwd,
          env,
          skipPermissions,
          resolvedModel,
          statusModel,
          resolvedReasoningEffort,
          imagePaths,
        } = params;
        const attemptState: CodexAttemptState = {
          resumeSessionId,
          sawConversationEvent: false,
          deferredErrorMessage: null,
          nonTerminalErrorMessage: null,
        };
        let stdoutBuffer = '';
        let stderrBuffer = '';

        const flushStdout = () => {
          let newlineIndex = stdoutBuffer.indexOf('\n');
          while (newlineIndex >= 0) {
            const line = stdoutBuffer.slice(0, newlineIndex).trim();
            stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
            if (line) {
              const parsed = safeJsonParse(line);
              if (parsed) {
                handleThreadEvent(parsed, attemptState, resolvedModel, statusModel);
              }
            }
            newlineIndex = stdoutBuffer.indexOf('\n');
          }
        };

        const attemptPrompt = resumeSessionId
          ? buildCodexPrompt(prompt, { files })
          : buildCodexPrompt(prompt, {
              history: conversationHistory,
              systemPrompt,
              files,
            });
        const args = buildLegacyCodexArgs({
          cwd,
          prompt: attemptPrompt,
          permissionMode,
          skipPermissions,
          resolvedModel,
          resolvedReasoningEffort,
          imagePaths,
          resumeSessionId,
        });

        const child: ChildProcessWithoutNullStreams = spawn(binary, args, {
          cwd,
          detached: process.platform !== 'win32',
          env,
          stdio: ['pipe', 'pipe', 'pipe'] as const,
        });
        currentChild = child;
        child.stdin.end();

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          stdoutBuffer += chunk;
          flushStdout();
        });

        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          stderrBuffer += chunk;
        });

        child.on('error', async (error: Error) => {
          await handleAttemptFailure(error, attemptState, resolvedModel);
        });

        const handleAbort = () => {
          terminateCodexProcess(child);
        };
        currentAbortHandler = handleAbort;
        streamAbortController.signal.addEventListener('abort', handleAbort, { once: true });

        child.on('close', async (code: number | null) => {
          if (currentAbortHandler === handleAbort) {
            streamAbortController.signal.removeEventListener('abort', handleAbort);
            currentAbortHandler = null;
          }

          currentChild = null;

          if (!doneEmitted) {
            const remaining = stdoutBuffer.trim();
            if (remaining) {
              const parsed = safeJsonParse(remaining);
              if (parsed) {
                handleThreadEvent(parsed, attemptState, resolvedModel, statusModel);
              }
            }
          }

          if (await maybeHandleDeferredResumeFailure(attemptState, resolvedModel)) {
            return;
          }

          const stderrText = stderrBuffer.trim();
          await handleAttemptFailure(
            stderrText
              || attemptState.nonTerminalErrorMessage
              || (code === 0
                ? 'Codex stream ended before turn completion'
                : `Codex exited with code ${code ?? 'unknown'}`),
            attemptState,
            resolvedModel,
          );
        });
      };

      const runSdkAttempt = async (
        params: {
          resumeSessionId?: string;
          binary: string;
          cwd: string;
          settings: CodexClientSettings;
          skipPermissions: boolean;
          resolvedModel?: string;
          statusModel?: string;
          resolvedReasoningEffort?: CodexReasoningEffort;
          imagePaths: string[];
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
          imagePaths,
        } = params;
        const attemptState: CodexAttemptState = {
          resumeSessionId,
          sawConversationEvent: false,
          deferredErrorMessage: null,
          nonTerminalErrorMessage: null,
        };

        try {
          const sdkLaunch = resolveCodexSdkLaunch(binary, settings.env);
          const runtimeConfig = buildSdkRuntimeConfig({
            binary: sdkLaunch.executablePath,
            settings: {
              ...settings,
              env: sdkLaunch.env,
            },
            cwd,
            skipPermissions,
            permissionMode,
            resolvedModel,
            resolvedReasoningEffort,
            prompt,
            systemPrompt,
            files,
            conversationHistory,
            imagePaths,
            resumeSessionId,
          });
          const CodexCtor = await loadCodexCtor();
          const codex = new CodexCtor(runtimeConfig.clientOptions);
          const thread = resumeSessionId
            ? codex.resumeThread(resumeSessionId, runtimeConfig.threadOptions)
            : codex.startThread(runtimeConfig.threadOptions);
          const { events } = await thread.runStreamed(runtimeConfig.input, {
            signal: streamAbortController.signal,
          });

          for await (const event of events) {
            handleThreadEvent(event, attemptState, resolvedModel, statusModel);
          }

          if (await maybeHandleDeferredResumeFailure(attemptState, resolvedModel)) {
            return;
          }

          if (!doneEmitted) {
            await handleAttemptFailure(
              new Error(
                attemptState.nonTerminalErrorMessage
                  || 'Codex stream ended before turn completion',
              ),
              attemptState,
              resolvedModel,
            );
            return;
          }
          finalizeAttempt();
        } catch (error) {
          await handleAttemptFailure(error, attemptState, resolvedModel);
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

        const codexBackend = getCodexBackend();
        const binary = findCodexBinary();
        if (!binary) {
          emitEvent({ type: 'error', data: 'Codex CLI is not installed' });
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
        const settings = await buildCodexClientSettings();
        const skipPermissions = isDangerouslySkipPermissionsEnabled(getSetting('dangerously_skip_permissions'));

        console.info('[codex-client] model resolution', {
          codexBackend,
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

        if (codexBackend === 'legacy-cli') {
          runLegacyAttempt({
            resumeSessionId,
            binary: binary!,
            cwd,
            env: settings.env,
            skipPermissions,
            resolvedModel,
            statusModel,
            resolvedReasoningEffort: effectiveReasoningEffort,
            imagePaths,
          });
          return;
        }

        await runSdkAttempt({
          resumeSessionId,
          binary,
          cwd,
          settings,
          skipPermissions,
          resolvedModel,
          statusModel,
          resolvedReasoningEffort: effectiveReasoningEffort,
          imagePaths,
        });
      };

      void runAttempt(sdkSessionId);
    },

    cancel() {
      if (currentChild) {
        terminateCodexProcess(currentChild);
      }
      streamAbortController.abort();
    },
  });
}
