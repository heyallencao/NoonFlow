import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const UPLOAD_FILES_DIRNAME = 'upload_files';

function getNoonFlowHomeDir(): string {
  return path.join(os.homedir(), '.noonflow');
}

function getLegacyHomeDirs(): string[] {
  return [path.join(os.homedir(), '.monolith')];
}

function getManagedHomeDirs(): string[] {
  return [getNoonFlowHomeDir(), ...getLegacyHomeDirs()];
}

/**
 * Generate a stable project identifier from the working directory path.
 * Uses basename + first 8 chars of MD5 hash to avoid collisions.
 */
export function getUploadProjectIdentifier(workDir: string): string {
  const basename = path.basename(workDir);
  const hash = crypto.createHash('md5').update(workDir).digest('hex').slice(0, 8);
  return `${basename}_${hash}`;
}

/**
 * Returns ~/.noonflow/upload_files/{project-identifier}/ for uploaded files.
 */
export function getProjectUploadDir(workDir: string): string {
  const projectId = getUploadProjectIdentifier(workDir);
  const uploadDir = path.join(getNoonFlowHomeDir(), UPLOAD_FILES_DIRNAME, projectId);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  return uploadDir;
}

/**
 * Allow serving both the current upload_files layout and the previous
 * per-project upload layout so older persisted attachments still render.
 */
export function isManagedUploadPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const legacyDirs = [
    '.noonflow-uploads',
    '.noonflow-media',
    '.noonflow-images',
    '.monolith-uploads',
    '.monolith-media',
    '.monolith-images',
  ];

  if (legacyDirs.some((dir) => resolved.includes(dir))) {
    return true;
  }

  for (const homeDir of getManagedHomeDirs()) {
    const rel = path.relative(homeDir, resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      continue;
    }

    const segments = rel.split(path.sep).filter(Boolean);
    if (segments.includes('upload') || segments.includes(UPLOAD_FILES_DIRNAME)) {
      return true;
    }
  }

  return false;
}
