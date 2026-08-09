import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextResponse } from 'next/server';
import {
  findClaudeBinary,
  findCodexBinary,
  findPiBinary,
  getClaudeVersion,
  getCodexVersion,
  getPiVersion,
} from '@/lib/platform';
import { sanitizeEnvironmentJson, type SanitizedJsonValue } from '@/lib/environment-snapshot';

type JsonValue = SanitizedJsonValue;

interface FileSnapshot<T = JsonValue | string> {
  path: string;
  exists: boolean;
  content: T | null;
  error?: string;
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
      content: sanitizeEnvironmentJson(parsed),
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
    const piAgentDir = process.env.PI_CODING_AGENT_DIR?.trim()
      ? process.env.PI_CODING_AGENT_DIR.trim().replace(/^~(?=$|[\\/])/, home)
      : path.join(home, '.pi', 'agent');
    const piSettingsPath = path.join(piAgentDir, 'settings.json');
    const piAuthPath = path.join(piAgentDir, 'auth.json');
    const piModelsPath = path.join(piAgentDir, 'models.json');
    const piTrustPath = path.join(piAgentDir, 'trust.json');
    const piGlobalAgentsMdPath = path.join(piAgentDir, 'AGENTS.md');

    const [claudePath, codexPath, piPath] = [findClaudeBinary(), findCodexBinary(), findPiBinary()];
    const [claudeVersion, codexVersion, piVersion] = await Promise.all([
      claudePath ? getClaudeVersion(claudePath) : Promise.resolve(null),
      codexPath ? getCodexVersion(codexPath) : Promise.resolve(null),
      piPath ? getPiVersion(piPath) : Promise.resolve(null),
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
        pi: {
          binaryPath: piPath || null,
          version: piVersion,
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
        piSettings: readJsonFile(piSettingsPath),
        piAuth: readJsonFile(piAuthPath),
        piModels: readJsonFile(piModelsPath),
        piTrust: readJsonFile(piTrustPath),
        piGlobalAgentsMd: readTextFile(piGlobalAgentsMdPath),
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
