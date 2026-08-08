import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { PluginInfo, ErrorResponse, SuccessResponse } from '@/types';

function getClaudeDir(): string {
  return path.join(os.homedir(), '.claude');
}

function getSettingsPath(): string {
  return path.join(getClaudeDir(), 'settings.json');
}

function readSettings(): Record<string, unknown> {
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  const settingsPath = getSettingsPath();
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ plugin: PluginInfo } | ErrorResponse>> {
  const { id } = await params;
  const pluginName = decodeURIComponent(id);

  // Check in commands directory
  const commandsDir = path.join(getClaudeDir(), 'commands');
  const filePath = path.join(commandsDir, `${pluginName}.md`);

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const firstLine = content.split('\n')[0]?.trim() || '';
    return NextResponse.json({
      plugin: {
        name: pluginName,
        description: firstLine.startsWith('#')
          ? firstLine.replace(/^#+\s*/, '')
          : `Skill: /${pluginName}`,
        enabled: true,
      },
    });
  }

  // Check in settings customCommands
  const settings = readSettings();
  const customCommands = (settings.customCommands || {}) as Record<
    string,
    { description?: string; enabled?: boolean }
  >;
  if (customCommands[pluginName]) {
    const cmd = customCommands[pluginName];
    return NextResponse.json({
      plugin: {
        name: pluginName,
        description: cmd.description || `Custom command: /${pluginName}`,
        enabled: cmd.enabled !== false,
      },
    });
  }

  return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const { id } = await params;
    const pluginName = decodeURIComponent(id);
    const body = await request.json();
    const { enabled } = body as { enabled: boolean };

    const settings = readSettings();
    if (!settings.customCommands) {
      settings.customCommands = {};
    }

    const customCommands = settings.customCommands as Record<
      string,
      { description?: string; enabled?: boolean }
    >;

    if (customCommands[pluginName]) {
      customCommands[pluginName].enabled = enabled;
    } else {
      customCommands[pluginName] = { enabled };
    }

    writeSettings(settings);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update plugin' },
      { status: 500 }
    );
  }
}
