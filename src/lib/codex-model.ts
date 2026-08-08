import fs from 'fs';
import os from 'os';
import path from 'path';
import { getSetting } from './db';
import { SETTING_KEYS } from '@/types';

const CODEX_PLACEHOLDER_MODELS = new Set(['codex']);

export function normalizeCodexModel(model?: string | null): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) {
    return undefined;
  }

  return CODEX_PLACEHOLDER_MODELS.has(trimmed.toLowerCase()) ? undefined : trimmed;
}

export function getCodexConfigModel(): string | undefined {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const match = content.match(/^model\s*=\s*["']([^"']+)["']\s*$/m);
    return normalizeCodexModel(match?.[1]);
  } catch {
    return undefined;
  }
}

export function resolvePreferredCodexModel(model?: string | null): string | undefined {
  return normalizeCodexModel(model)
    || normalizeCodexModel(getSetting(SETTING_KEYS.CODEX_DEFAULT_MODEL))
    || getCodexConfigModel();
}
