import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { ChatSession, Message, TaskItem } from "@/types";
import { getDb } from "@/lib/db";
import { getWorkspaceName, normalizeWorkspacePath } from "@/lib/workspace-utils";

const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), ".noonflow");
const archiveDir = path.join(dataDir, "memory-archives");

export interface MemoryArchiveSession {
  session: ChatSession;
  messages: Message[];
  tasks: TaskItem[];
}

export interface MemoryArchiveRecord {
  id: string;
  workspacePath: string;
  workspaceName: string;
  archivedAt: string;
  sessionCount: number;
  messageCount: number;
  taskCount: number;
  note: string;
  sessions: MemoryArchiveSession[];
}

export interface MemoryArchiveSummary {
  id: string;
  workspacePath: string;
  workspaceName: string;
  archivedAt: string;
  sessionCount: number;
  messageCount: number;
  taskCount: number;
  note: string;
  fileSize: number;
}

function archiveFilePath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(archiveDir, `${safe}.json`);
}

async function ensureArchiveDir() {
  await fs.mkdir(archiveDir, { recursive: true });
}

function getSessionsByWorkspace(workspacePath: string): ChatSession[] {
  const db = getDb();
  const direct = db
    .prepare("SELECT * FROM chat_sessions WHERE working_directory = ? ORDER BY updated_at DESC")
    .all(workspacePath) as ChatSession[];

  if (direct.length > 0) return direct;

  const all = db.prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC").all() as ChatSession[];
  const normalized = normalizeWorkspacePath(workspacePath);
  return all.filter(
    (session) => normalizeWorkspacePath(session.working_directory || "") === normalized
  );
}

function getSessionsByWorktreeId(worktreeId: string): ChatSession[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM chat_sessions WHERE worktree_id = ? ORDER BY updated_at DESC")
    .all(worktreeId) as ChatSession[];
}

function getMessagesBySession(sessionId: string): Message[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as Message[];
}

function getTasksBySession(sessionId: string): TaskItem[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as TaskItem[];
}

export async function archiveAndDeleteWorkspaceSessions(
  workspacePath: string
): Promise<{ archive: MemoryArchiveSummary; deletedSessionIds: string[] }> {
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  if (!normalizedPath) {
    throw new Error("Workspace path is required");
  }

  const sessions = getSessionsByWorkspace(normalizedPath);
  const sessionBundles: MemoryArchiveSession[] = sessions.map((session) => ({
    session,
    messages: getMessagesBySession(session.id),
    tasks: getTasksBySession(session.id),
  }));

  const messageCount = sessionBundles.reduce((sum, item) => sum + item.messages.length, 0);
  const taskCount = sessionBundles.reduce((sum, item) => sum + item.tasks.length, 0);
  const archiveId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const archivedAt = new Date().toISOString();

  const record: MemoryArchiveRecord = {
    id: archiveId,
    workspacePath: normalizedPath,
    workspaceName: getWorkspaceName(normalizedPath),
    archivedAt,
    sessionCount: sessionBundles.length,
    messageCount,
    taskCount,
    note: "Workspace deleted from chat list. Sessions are archived here for memory management.",
    sessions: sessionBundles,
  };

  await ensureArchiveDir();
  const filePath = archiveFilePath(archiveId);
  const payload = JSON.stringify(record, null, 2);
  await fs.writeFile(filePath, payload, "utf8");

  const db = getDb();
  const ids = sessionBundles.map((bundle) => bundle.session.id);
  const deleteTx = db.transaction((sessionIds: string[]) => {
    const stmt = db.prepare("DELETE FROM chat_sessions WHERE id = ?");
    for (const id of sessionIds) stmt.run(id);
  });
  deleteTx(ids);

  const stat = await fs.stat(filePath);
  const archive: MemoryArchiveSummary = {
    id: record.id,
    workspacePath: record.workspacePath,
    workspaceName: record.workspaceName,
    archivedAt: record.archivedAt,
    sessionCount: record.sessionCount,
    messageCount: record.messageCount,
    taskCount: record.taskCount,
    note: record.note,
    fileSize: stat.size,
  };

  return { archive, deletedSessionIds: ids };
}

export async function listMemoryArchives(): Promise<MemoryArchiveSummary[]> {
  await ensureArchiveDir();
  const files = await fs.readdir(archiveDir);
  const jsonFiles = files.filter((name) => name.endsWith(".json"));

  const summaries: MemoryArchiveSummary[] = [];
  for (const filename of jsonFiles) {
    const fullPath = path.join(archiveDir, filename);
    try {
      const [raw, stat] = await Promise.all([fs.readFile(fullPath, "utf8"), fs.stat(fullPath)]);
      const parsed = JSON.parse(raw) as Partial<MemoryArchiveRecord>;
      if (!parsed.id || !parsed.workspacePath || !parsed.archivedAt) continue;

      summaries.push({
        id: parsed.id,
        workspacePath: parsed.workspacePath,
        workspaceName: parsed.workspaceName || getWorkspaceName(parsed.workspacePath),
        archivedAt: parsed.archivedAt,
        sessionCount: Number(parsed.sessionCount || 0),
        messageCount: Number(parsed.messageCount || 0),
        taskCount: Number(parsed.taskCount || 0),
        note: parsed.note || "",
        fileSize: stat.size,
      });
    } catch {
      // Skip invalid archive file
    }
  }

  summaries.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  return summaries;
}

export async function getMemoryArchiveById(id: string): Promise<MemoryArchiveRecord | null> {
  const filePath = archiveFilePath(id);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as MemoryArchiveRecord;
    if (!parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function archiveAndDeleteWorktreeSessions(
  worktreeId: string,
  worktreePath: string,
): Promise<{ archive: MemoryArchiveSummary; deletedSessionIds: string[] }> {
  const sessions = getSessionsByWorktreeId(worktreeId);
  if (sessions.length === 0) {
    return {
      archive: {
        id: '',
        workspacePath: worktreePath,
        workspaceName: getWorkspaceName(worktreePath),
        archivedAt: new Date().toISOString(),
        sessionCount: 0,
        messageCount: 0,
        taskCount: 0,
        note: 'No sessions to archive',
        fileSize: 0,
      },
      deletedSessionIds: [],
    };
  }

  const sessionBundles: MemoryArchiveSession[] = sessions.map((session) => ({
    session,
    messages: getMessagesBySession(session.id),
    tasks: getTasksBySession(session.id),
  }));

  const messageCount = sessionBundles.reduce((sum, item) => sum + item.messages.length, 0);
  const taskCount = sessionBundles.reduce((sum, item) => sum + item.tasks.length, 0);
  const archiveId = `wt-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const archivedAt = new Date().toISOString();

  const record: MemoryArchiveRecord = {
    id: archiveId,
    workspacePath: worktreePath,
    workspaceName: getWorkspaceName(worktreePath),
    archivedAt,
    sessionCount: sessionBundles.length,
    messageCount,
    taskCount,
    note: `Worktree deleted. Sessions archived for memory management.`,
    sessions: sessionBundles,
  };

  await ensureArchiveDir();
  const filePath = archiveFilePath(archiveId);
  const payload = JSON.stringify(record, null, 2);
  await fs.writeFile(filePath, payload, "utf8");

  const db = getDb();
  const ids = sessionBundles.map((bundle) => bundle.session.id);
  const deleteTx = db.transaction((sessionIds: string[]) => {
    const stmt = db.prepare("DELETE FROM chat_sessions WHERE id = ?");
    for (const id of sessionIds) stmt.run(id);
  });
  deleteTx(ids);

  const stat = await fs.stat(filePath);
  const archive: MemoryArchiveSummary = {
    id: record.id,
    workspacePath: record.workspacePath,
    workspaceName: record.workspaceName,
    archivedAt: record.archivedAt,
    sessionCount: record.sessionCount,
    messageCount: record.messageCount,
    taskCount: record.taskCount,
    note: record.note,
    fileSize: stat.size,
  };

  return { archive, deletedSessionIds: ids };
}

export async function deleteMemoryArchiveById(id: string): Promise<boolean> {
  const filePath = archiveFilePath(id);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
