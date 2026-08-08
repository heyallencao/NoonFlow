import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { spawnSkillsCli } from "@/lib/skills-cli";

function getInstalledSkillsDir(): string {
  return path.join(os.homedir(), ".agents", "skills");
}

function getClaudeSkillsDir(): string {
  return path.join(os.homedir(), ".claude", "skills");
}

function getGlobalCommandsDir(): string {
  return path.join(os.homedir(), ".claude", "commands");
}

function getPluginCommandsDirs(): string[] {
  const dirs: string[] = [];
  const marketplacesDir = path.join(os.homedir(), ".claude", "plugins", "marketplaces");
  if (!fs.existsSync(marketplacesDir)) return dirs;

  try {
    const marketplaces = fs.readdirSync(marketplacesDir);
    for (const marketplace of marketplaces) {
      const pluginsDir = path.join(marketplacesDir, marketplace, "plugins");
      if (!fs.existsSync(pluginsDir)) continue;
      const plugins = fs.readdirSync(pluginsDir);
      for (const plugin of plugins) {
        const commandsDir = path.join(pluginsDir, plugin, "commands");
        if (fs.existsSync(commandsDir)) {
          dirs.push(commandsDir);
        }
      }
    }
  } catch {
    // ignore
  }
  return dirs;
}

function extractSkillNameFromSource(source: string): string | null {
  // Extract skill name from various source formats:
  // - "owner/repo" -> "repo"
  // - "owner/repo/skill-name" -> "skill-name"
  // - "https://github.com/owner/repo" -> "repo"
  const parts = source.replace(/^https?:\/\/[^/]+\//, "").split("/");
  return parts[parts.length - 1] || null;
}

function checkSkillExists(skillName: string, runtime: "claude-code" | "codex"): boolean {
  const installedDir =
    runtime === "codex" ? getInstalledSkillsDir() : getClaudeSkillsDir();
  if (fs.existsSync(path.join(installedDir, skillName))) {
    return true;
  }

  // Check in ~/.claude/commands/
  const globalDir = getGlobalCommandsDir();
  if (fs.existsSync(globalDir)) {
    const files = fs.readdirSync(globalDir);
    if (files.some(f => f === `${skillName}.md` || f === skillName)) {
      return true;
    }
  }

  // Check in plugin commands
  for (const dir of getPluginCommandsDirs()) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      if (files.some(f => f === `${skillName}.md` || f === skillName)) {
        return true;
      }
    }
  }

  return false;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source, global: isGlobal, runtime = "claude-code" } = body as {
      source: string;
      global?: boolean;
      runtime?: "claude-code" | "codex";
    };

    if (!source || typeof source !== "string") {
      return NextResponse.json(
        { error: "source is required" },
        { status: 400 }
      );
    }

    const validRuntimes = ["claude-code", "codex"];
    if (!validRuntimes.includes(runtime)) {
      return NextResponse.json(
        { error: `Invalid runtime: ${runtime}. Must be one of: ${validRuntimes.join(", ")}` },
        { status: 400 }
      );
    }

    // Extract skill name and check if it already exists
    const skillName = extractSkillNameFromSource(source);
    if (skillName && checkSkillExists(skillName, runtime)) {
      return NextResponse.json(
        { error: `A skill named "${skillName}" already exists. Please remove it first or choose a different skill.` },
        { status: 409 }
      );
    }

    const args = ["add", source, "-y", "--agent", runtime];
    if (isGlobal !== false) {
      args.splice(3, 0, "-g");
    }

    const child = spawnSkillsCli(args, {
      env: { ...process.env },
    });

    const encoder = new TextEncoder();
    let controllerClosed = false;
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: string) => {
          if (controllerClosed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch {
            // Controller may have been closed already
          }
        };

        child.stdout?.on("data", (chunk: Buffer) => {
          send("output", chunk.toString());
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          send("output", chunk.toString());
        });

        child.on("close", (code) => {
          if (controllerClosed) return;
          controllerClosed = true;
          if (code === 0) {
            send("done", "Install completed successfully");
          } else {
            send("error", `Process exited with code ${code}`);
          }
          try { controller.close(); } catch { /* already closed */ }
        });

        child.on("error", (err) => {
          if (controllerClosed) return;
          controllerClosed = true;
          send("error", err.message);
          try { controller.close(); } catch { /* already closed */ }
        });
      },
      cancel() {
        child.kill();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[marketplace/install] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Install failed" },
      { status: 500 }
    );
  }
}
