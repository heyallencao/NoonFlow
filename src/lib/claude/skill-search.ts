import os from 'node:os';
import path from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';

import { getActiveProvider } from '../db';
import { findClaudePath, resolveScriptFromCmd } from '../claude-client/env';
import { buildClaudeRuntimeEnvironment } from './runtime-settings';

export interface ClaudeSkillSearchOptions {
  prompt: string;
  systemPrompt: string;
  model?: string;
}

type ClaudeSkillSearchRunner = (options: ClaudeSkillSearchOptions) => Promise<string>;

const SKILL_SEARCH_TIMEOUT_MS = 5_000;
let skillSearchRunnerOverride: ClaudeSkillSearchRunner | null = null;
let claudeQueryFactory: typeof query = query;

export function __setClaudeSkillSearchRunnerForTests(runner: ClaudeSkillSearchRunner | null): void {
  skillSearchRunnerOverride = runner;
}

export function __setClaudeSkillSearchQueryForTests(factory: typeof query | null): void {
  claudeQueryFactory = factory ?? query;
}

export async function runClaudeSkillSearch({
  prompt,
  systemPrompt,
  model,
}: ClaudeSkillSearchOptions): Promise<string> {
  if (skillSearchRunnerOverride) {
    return skillSearchRunnerOverride({ prompt, systemPrompt, model });
  }

  const detectedPath = findClaudePath();
  if (!detectedPath) throw new Error('Claude Code CLI not found');

  let executablePath = detectedPath;
  if (/\.(cmd|bat)$/i.test(path.extname(detectedPath))) {
    const resolved = resolveScriptFromCmd(detectedPath);
    if (!resolved) throw new Error('Claude Code CLI wrapper could not be resolved');
    executablePath = resolved;
  }

  const abortController = new AbortController();
  let conversation: Query | null = null;
  const timeout = setTimeout(() => {
    abortController.abort();
    conversation?.close();
  }, SKILL_SEARCH_TIMEOUT_MS);
  timeout.unref?.();

  try {
    const normalizedModel = model?.trim();
    conversation = claudeQueryFactory({
      prompt,
      options: {
        cwd: os.homedir(),
        abortController,
        env: await buildClaudeRuntimeEnvironment(getActiveProvider()),
        maxTurns: 1,
        pathToClaudeCodeExecutable: executablePath,
        permissionMode: 'dontAsk',
        settingSources: ['user', 'project', 'local'],
        systemPrompt,
        thinking: { type: 'disabled' },
        tools: [],
        ...(normalizedModel ? { model: normalizedModel } : {}),
      },
    });

    let result = '';
    for await (const message of conversation) {
      if (message.type !== 'result') continue;
      if (message.subtype !== 'success' || message.is_error) {
        throw new Error('Claude Code skill search failed');
      }
      result = (message as SDKResultSuccess).result;
    }
    return result;
  } finally {
    clearTimeout(timeout);
    conversation?.close();
  }
}
