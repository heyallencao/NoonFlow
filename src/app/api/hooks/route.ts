import fs from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import type { HookItem, HookScriptSnapshot } from "@/components/automation/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HookRuntime = "claude" | "codex";

interface HookCommand {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookCommand[];
  [key: string]: unknown;
}

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function summarizeCommand(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length <= 72) {
    return trimmed;
  }
  return `${trimmed.slice(0, 69)}...`;
}

function tokenizeCommand(command: string): string[] {
  return Array.from(command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g))
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter(Boolean);
}

function inferScriptLanguage(scriptPath: string | null): string {
  if (!scriptPath) {
    return "markdown";
  }

  const ext = path.extname(scriptPath).toLowerCase();
  switch (ext) {
    case ".sh":
    case ".bash":
    case ".zsh":
      return "bash";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".ts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".py":
      return "python";
    case ".json":
      return "json";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".toml":
      return "toml";
    case ".md":
      return "markdown";
    default:
      return "markdown";
  }
}

function resolveCommandScriptPath(command: string, configFilePath: string): string | null {
  const homeDir = os.homedir();
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) {
    return null;
  }

  const executableTokens = new Set([
    "bash",
    "sh",
    "zsh",
    "node",
    "bun",
    "python",
    "python3",
    "ruby",
    "deno",
  ]);

  const rawCandidate = executableTokens.has(tokens[0]) ? (tokens[1] ?? "") : tokens[0];
  if (!rawCandidate) {
    return null;
  }

  const expandedCandidate = rawCandidate.startsWith("~/")
    ? path.join(homeDir, rawCandidate.slice(2))
    : rawCandidate;

  if (path.isAbsolute(expandedCandidate)) {
    return expandedCandidate;
  }

  return path.resolve(path.dirname(configFilePath), expandedCandidate);
}

function readScriptSnapshot(command: string, configFilePath: string): HookScriptSnapshot {
  const scriptPath = resolveCommandScriptPath(command, configFilePath);
  const language = inferScriptLanguage(scriptPath);

  if (!scriptPath) {
    return {
      command,
      scriptPath: null,
      exists: false,
      content: null,
      error: "Unable to resolve script path",
      language,
    };
  }

  try {
    if (!fs.existsSync(scriptPath)) {
      return {
        command,
        scriptPath,
        exists: false,
        content: null,
        error: "Script file not found",
        language,
      };
    }

    return {
      command,
      scriptPath,
      exists: true,
      content: fs.readFileSync(scriptPath, "utf-8"),
      language,
    };
  } catch (error) {
    return {
      command,
      scriptPath,
      exists: true,
      content: null,
      error: error instanceof Error ? error.message : String(error),
      language,
    };
  }
}

function extractHookItems(
  runtime: HookRuntime,
  filePath: string,
  hooksConfig: unknown,
): HookItem[] {
  if (!hooksConfig || typeof hooksConfig !== "object") {
    return [];
  }

  const items: HookItem[] = [];

  for (const [event, rawGroups] of Object.entries(hooksConfig as Record<string, unknown>)) {
    if (!Array.isArray(rawGroups)) {
      continue;
    }

    rawGroups.forEach((rawGroup, index) => {
      const group = (rawGroup && typeof rawGroup === "object" ? rawGroup : {}) as HookGroup;
      const hooks = Array.isArray(group.hooks) ? group.hooks : [];
      const commands = hooks
        .map((hook) => (typeof hook.command === "string" ? hook.command : ""))
        .filter(Boolean);
      const scripts = commands.map((command) => readScriptSnapshot(command, filePath));
      const matcherLabel = typeof group.matcher === "string" && group.matcher.trim()
        ? group.matcher.trim()
        : undefined;
      const description = commands.length > 0
        ? `${matcherLabel ? `${matcherLabel} · ` : ""}${summarizeCommand(commands[0])}`
        : `${matcherLabel ? `${matcherLabel} · ` : ""}${event} hook`;

      items.push({
        id: `${runtime}:${event}:${index}`,
        runtime,
        event,
        matcher: matcherLabel,
        description,
        filePath,
        commandCount: commands.length,
        commands,
        scripts,
        content: group,
      });
    });
  }

  return items;
}

export async function GET() {
  const homeDir = os.homedir();
  const claudeSettingsPath = path.join(homeDir, ".claude", "settings.json");
  const codexHooksPath = path.join(homeDir, ".codex", "hooks.json");

  const claudeSettings = readJsonFile(claudeSettingsPath);
  const codexHooksFile = readJsonFile(codexHooksPath);

  const hooks = [
    ...extractHookItems("claude", claudeSettingsPath, claudeSettings.hooks),
    ...extractHookItems("codex", codexHooksPath, codexHooksFile.hooks),
  ].sort((left, right) => {
    if (left.runtime !== right.runtime) {
      return left.runtime.localeCompare(right.runtime);
    }
    if (left.event !== right.event) {
      return left.event.localeCompare(right.event);
    }
    return left.id.localeCompare(right.id);
  });

  return NextResponse.json({ hooks });
}
