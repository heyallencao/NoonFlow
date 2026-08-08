import fs from 'fs';
import path from 'path';

import { findClaudeBinary } from '../platform';

/**
 * Sanitize a string for use as an environment variable value.
 * Removes null bytes and control characters that cause spawn EINVAL.
 */
export function sanitizeEnvValue(value: string): string {
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitize all values in an env record so child_process.spawn won't
 * throw EINVAL due to invalid characters or non-string values.
 * On Windows, spawn is strict: every env value MUST be a string.
 * Spreading process.env can include undefined values which cause EINVAL.
 */
export function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      clean[key] = sanitizeEnvValue(value);
    }
  }
  return clean;
}

/**
 * On Windows, npm installs CLI tools as .cmd wrappers that can't be
 * spawned without shell:true. Parse the wrapper to extract the real
 * .js script path so we can pass it to the SDK directly.
 */
export function resolveScriptFromCmd(cmdPath: string): string | undefined {
  try {
    const content = fs.readFileSync(cmdPath, 'utf-8');
    const cmdDir = path.dirname(cmdPath);

    const patterns = [
      /"%~dp0\\([^"]*claude[^"]*\.js)"/i,
      /%~dp0\\(\S*claude\S*\.js)/i,
      /"%dp0%\\([^"]*claude[^"]*\.js)"/i,
    ];

    for (const re of patterns) {
      const match = content.match(re);
      if (!match) {
        continue;
      }
      const resolved = path.normalize(path.join(cmdDir, match[1]));
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
  } catch {
    // Ignore read errors.
  }

  return undefined;
}

let cachedClaudePath: string | null | undefined;

export function findClaudePath(): string | undefined {
  if (cachedClaudePath !== undefined) {
    return cachedClaudePath || undefined;
  }

  const found = findClaudeBinary();
  cachedClaudePath = found ?? null;
  return found;
}
