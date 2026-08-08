import fs from "fs";
import path from "path";
import os from "os";
import type { SkillLockFile } from "@/types";

const LOCK_FILE_PATH = path.join(os.homedir(), ".agents", ".skill-lock.json");

export function readLockFile(): SkillLockFile {
  try {
    if (!fs.existsSync(LOCK_FILE_PATH)) {
      return { version: 0, skills: {} };
    }
    const raw = fs.readFileSync(LOCK_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      version: parsed.version ?? 0,
      skills: parsed.skills ?? {},
    };
  } catch {
    return { version: 0, skills: {} };
  }
}
