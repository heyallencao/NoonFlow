import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextResponse } from 'next/server';
import {
  findClaudeBinary,
  findCodexBinary,
  getClaudeVersion,
  getCodexVersion,
} from '@/lib/platform';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface FileSnapshot<T = JsonValue | string> {
  path: string;
  exists: boolean;
  content: T | null;
  error?: string;
}

function maskSecretValue(value: string): string {
  if (value.length <= 8) {
    return '*'.repeat(Math.max(value.length, 4));
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function sanitizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }

  if (typeof value === 'object') {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (typeof raw === 'string' && /(token|secret|password|api[_-]?key)/i.test(key)) {
        result[key] = maskSecretValue(raw);
      } else {
        result[key] = sanitizeJson(raw);
      }
    }
    return result;
  }

  return String(value);
}

function readJsonFile(filePath: string): FileSnapshot<JsonValue> {
  try {
    if (!fs.existsSync(filePath)) {
      return { path: filePath, exists: false, content: null };
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return {
      path: filePath,
      exists: true,
      content: sanitizeJson(parsed),
    };
  } catch (error) {
    return {
      path: filePath,
      exists: true,
      content: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readTextFile(filePath: string): FileSnapshot<string> {
  try {
    if (!fs.existsSync(filePath)) {
      return { path: filePath, exists: false, content: null };
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    return {
      path: filePath,
      exists: true,
      content: raw,
    };
  } catch (error) {
    return {
      path: filePath,
      exists: true,
      content: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  try {
    const home = os.homedir();
    const claudeSettingsPath = path.join(home, '.claude', 'settings.json');
    const claudeLegacyConfigPath = path.join(home, '.claude.json');
    const claudeCredentialsPath = path.join(home, '.claude', '.credentials.json');
    const claudeGlobalClaudeMdPath = path.join(home, '.claude', 'CLAUDE.md');
    const codexConfigPath = path.join(home, '.codex', 'config.toml');
    const codexAuthPath = path.join(home, '.codex', 'auth.json');
    const codexGlobalAgentsMdPath = path.join(home, '.codex', 'AGENTS.md');

    const [claudePath, codexPath] = [findClaudeBinary(), findCodexBinary()];
    const [claudeVersion, codexVersion] = await Promise.all([
      claudePath ? getClaudeVersion(claudePath) : Promise.resolve(null),
      codexPath ? getCodexVersion(codexPath) : Promise.resolve(null),
    ]);
    return NextResponse.json({
      runtimes: {
        claude: {
          binaryPath: claudePath || null,
          version: claudeVersion,
        },
        codex: {
          binaryPath: codexPath || null,
          version: codexVersion,
        },
      },
      files: {
        claudeSettings: readJsonFile(claudeSettingsPath),
        claudeLegacyConfig: readJsonFile(claudeLegacyConfigPath),
        claudeCredentials: readJsonFile(claudeCredentialsPath),
        claudeGlobalClaudeMd: readTextFile(claudeGlobalClaudeMdPath),
        codexConfig: readTextFile(codexConfigPath),
        codexAuth: readJsonFile(codexAuthPath),
        codexGlobalAgentsMd: readTextFile(codexGlobalAgentsMdPath),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load environment info',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
