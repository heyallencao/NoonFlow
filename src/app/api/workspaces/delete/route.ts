import { NextRequest } from "next/server";
import { deleteSession, getAllSessions, getWorktreesByWorkspace, deleteWorktreeRecord } from "@/lib/db";
import { normalizeWorkspacePath } from "@/lib/workspace-utils";
import { gitScanner } from "@/lib/git/scanner";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { workspacePath?: string };
    const workspacePath = body.workspacePath?.trim();

    if (!workspacePath) {
      return Response.json({ error: "workspacePath is required" }, { status: 400 });
    }

    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
    const deletedSessionIds: string[] = [];

    // Delete all sessions for this workspace
    const sessions = getAllSessions("all");
    for (const session of sessions) {
      const sessionWorkspacePath = normalizeWorkspacePath(session.working_directory || "");
      if (sessionWorkspacePath !== normalizedWorkspacePath) continue;
      if (deleteSession(session.id)) {
        deletedSessionIds.push(session.id);
      }
    }

    // Delete all worktrees for this workspace
    const worktrees = getWorktreesByWorkspace(normalizedWorkspacePath);
    for (const wt of worktrees) {
      if (!wt.is_default) {
        // Remove git worktree (best-effort)
        try {
          await gitScanner.removeWorktree(wt.worktree_path, true);
        } catch (err) {
          console.warn(`[workspace/delete] Failed to remove git worktree ${wt.worktree_path}:`, err);
        }
      }
      try {
        deleteWorktreeRecord(wt.id);
      } catch {
        // Default worktree deletion is blocked by guard; force-delete via raw SQL
        // This is acceptable during workspace deletion
        const { getDb } = await import("@/lib/db");
        getDb().prepare("DELETE FROM worktrees WHERE id = ?").run(wt.id);
      }
    }

    return Response.json({
      success: true,
      deletedSessionIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete workspace";
    return Response.json({ error: message }, { status: 500 });
  }
}
