import { NextResponse } from "next/server";
import { spawnSkillsCli } from "@/lib/skills-cli";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { skill, global: isGlobal, runtime = "claude-code" } = body as {
      skill: string;
      global?: boolean;
      runtime?: "claude-code" | "codex" | "pi";
    };

    if (!skill || typeof skill !== "string") {
      return NextResponse.json(
        { error: "skill name is required" },
        { status: 400 }
      );
    }

    const validRuntimes = ["claude-code", "codex", "pi"];
    if (!validRuntimes.includes(runtime)) {
      return NextResponse.json(
        { error: `Invalid runtime: ${runtime}. Must be one of: ${validRuntimes.join(", ")}` },
        { status: 400 }
      );
    }

    const args = ["remove", skill, "-y", "--agent", runtime === "pi" ? "codex" : runtime];
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
            send("done", "Uninstall completed successfully");
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
    console.error("[marketplace/remove] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remove failed" },
      { status: 500 }
    );
  }
}
