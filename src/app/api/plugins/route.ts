import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ErrorResponse } from '@/types';

export interface SkillInfo {
  name: string;
  description: string;
  source: 'global' | 'project';
  content: string;
  filePath: string;
  enabled: boolean;
}

export interface SkillsResponse {
  plugins: SkillInfo[];
}

function getClaudeDir(): string {
  return path.join(os.homedir(), '.claude');
}

function discoverSkills(): SkillInfo[] {
  const claudeDir = getClaudeDir();
  const skills: SkillInfo[] = [];

  // Scan for .md skill files in global commands directory
  const globalCommandsDir = path.join(claudeDir, 'commands');
  if (fs.existsSync(globalCommandsDir)) {
    try {
      const files = fs.readdirSync(globalCommandsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const name = file.replace(/\.md$/, '');
          const filePath = path.join(globalCommandsDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const firstLine = content.split('\n')[0]?.trim() || '';
          const description = firstLine.startsWith('#')
            ? firstLine.replace(/^#+\s*/, '')
            : `Skill: /${name}`;
          skills.push({
            name,
            description,
            source: 'global',
            content,
            filePath,
            enabled: true,
          });
        }
      }
    } catch {
      // ignore read errors
    }
  }

  // Scan project-level .claude/commands
  const projectCommandsDir = path.join(process.cwd(), '.claude', 'commands');
  if (fs.existsSync(projectCommandsDir)) {
    try {
      const files = fs.readdirSync(projectCommandsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const name = file.replace(/\.md$/, '');
          const filePath = path.join(projectCommandsDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const firstLine = content.split('\n')[0]?.trim() || '';
          const description = firstLine.startsWith('#')
            ? firstLine.replace(/^#+\s*/, '')
            : `Project skill: /${name}`;
          skills.push({
            name: `project:${name}`,
            description,
            source: 'project',
            content,
            filePath,
            enabled: true,
          });
        }
      }
    } catch {
      // ignore read errors
    }
  }

  return skills;
}

export async function GET(): Promise<NextResponse<SkillsResponse | ErrorResponse>> {
  try {
    const plugins = discoverSkills();
    return NextResponse.json({ plugins });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load plugins' },
      { status: 500 }
    );
  }
}
