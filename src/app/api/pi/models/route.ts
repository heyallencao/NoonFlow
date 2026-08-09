import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findPiBinary, getPiVersion, listPiModels } from '@/lib/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getNativeDefaultModel(): string {
  const configuredAgentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  const agentDir = configuredAgentDir
    ? configuredAgentDir.replace(/^~(?=$|[\\/])/, os.homedir())
    : path.join(os.homedir(), '.pi', 'agent');
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8')) as Record<string, unknown>;
    const provider = typeof settings.defaultProvider === 'string' ? settings.defaultProvider.trim() : '';
    const model = typeof settings.defaultModel === 'string' ? settings.defaultModel.trim() : '';
    return provider && model ? `${provider}/${model}` : model;
  } catch {
    return '';
  }
}

export async function GET() {
  const binary = findPiBinary();
  if (!binary) {
    return Response.json({
      installed: false,
      configured: false,
      version: null,
      default_model: '',
      models: [],
      error: 'Pi CLI is not installed',
    });
  }

  const [version, probe] = await Promise.all([
    getPiVersion(binary),
    listPiModels(binary),
  ]);
  return Response.json({
    installed: true,
    configured: probe.models.length > 0,
    version,
    default_model: getNativeDefaultModel(),
    models: probe.models,
    ...(probe.error ? { error: probe.error } : {}),
  });
}
