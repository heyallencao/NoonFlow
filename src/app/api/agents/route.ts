import fs from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import type { AgentItem } from "@/components/automation/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readTextFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function normalizeDescription(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function parseMarkdownAgent(content: string, fallbackName: string): Pick<AgentItem, "name" | "description"> {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const heading = lines.find((line) => line.startsWith("# "));
  const firstBodyLine = lines.find((line) => !line.startsWith("#"));

  return {
    name: heading ? heading.replace(/^#\s+/, "").trim() : fallbackName,
    description: normalizeDescription(firstBodyLine, "Claude Code agent role"),
  };
}

function extractYamlScalar(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"));
  if (!match) {
    return undefined;
  }

  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

function collectFilesRecursively(dirPath: string, predicate: (filePath: string) => boolean): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const results: string[] = [];

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(fullPath, predicate));
      continue;
    }

    if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }

  return results;
}

function scanClaudeAgents(homeDir: string): AgentItem[] {
  const agentsDir = path.join(homeDir, ".claude", "agents");
  if (!fs.existsSync(agentsDir)) {
    return [];
  }

  const items: AgentItem[] = [];

  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    if (entry.isDirectory()) {
      const dirPath = path.join(agentsDir, entry.name);
      const candidatePaths = [
        path.join(dirPath, "README.md"),
        path.join(dirPath, "AGENT.md"),
        path.join(dirPath, "agent.md"),
      ];
      const filePath = candidatePaths.find((candidate) => fs.existsSync(candidate))
        ?? collectFilesRecursively(dirPath, (value) => /\.(md|markdown|txt)$/i.test(value))[0];

      if (!filePath) {
        continue;
      }

      const content = readTextFile(filePath);
      if (!content) {
        continue;
      }

      const parsed = parseMarkdownAgent(content, entry.name);
      items.push({
        id: `claude:${filePath}`,
        runtime: "claude",
        name: parsed.name,
        description: parsed.description,
        filePath,
        format: "markdown",
        sourceName: entry.name,
        content,
      });
      continue;
    }

    if (!/\.(md|markdown|txt)$/i.test(entry.name)) {
      continue;
    }

    const filePath = path.join(agentsDir, entry.name);
    const content = readTextFile(filePath);
    if (!content) {
      continue;
    }

    const fallbackName = path.basename(entry.name, path.extname(entry.name));
    const parsed = parseMarkdownAgent(content, fallbackName);
    items.push({
      id: `claude:${filePath}`,
      runtime: "claude",
      name: parsed.name,
      description: parsed.description,
      filePath,
      format: "markdown",
      sourceName: fallbackName,
      content,
    });
  }

  return items;
}

function scanCodexAgents(homeDir: string): AgentItem[] {
  const skillsDir = path.join(homeDir, ".codex", "skills");
  const agentFiles = collectFilesRecursively(
    skillsDir,
    (filePath) => /\/agents\/.+\.(yaml|yml)$/i.test(filePath.replaceAll("\\", "/")),
  );

  return agentFiles
    .map((filePath) => {
      const content = readTextFile(filePath);
      if (!content) {
        return null;
      }

      const name = extractYamlScalar(content, "display_name")
        ?? path.basename(filePath, path.extname(filePath));
      const description = normalizeDescription(
        extractYamlScalar(content, "short_description"),
        "Codex agent role",
      );
      const defaultPrompt = extractYamlScalar(content, "default_prompt");
      const sourceName = path.basename(path.dirname(path.dirname(filePath)));

      const item: AgentItem = {
        id: `codex:${filePath}`,
        runtime: "codex",
        name,
        description,
        filePath,
        format: "yaml",
        sourceName,
        defaultPrompt,
        content,
      };

      return item;
    })
    .filter((item): item is AgentItem => Boolean(item));
}

export async function GET() {
  const homeDir = os.homedir();

  const agents = [
    ...scanClaudeAgents(homeDir),
    ...scanCodexAgents(homeDir),
  ].sort((left, right) => {
    if (left.runtime !== right.runtime) {
      return left.runtime.localeCompare(right.runtime);
    }
    return left.name.localeCompare(right.name);
  });

  return NextResponse.json({ agents });
}
