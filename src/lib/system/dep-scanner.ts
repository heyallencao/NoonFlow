import fs from 'fs/promises';
import path from 'path';

export interface Dependency {
  name: string;
  version: string;
  type: 'prod' | 'dev' | 'peer' | 'optional';
  language: 'nodejs' | 'python' | 'go' | 'rust';
  isOutdated?: boolean;
}

/**
 * Scan Node.js dependencies from package.json
 */
async function scanNodeJsDeps(repoPath: string): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  const pkgPath = path.join(repoPath, 'package.json');

  try {
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);

    // Production dependencies
    if (pkg.dependencies) {
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        deps.push({
          name,
          version: version as string,
          type: 'prod',
          language: 'nodejs',
        });
      }
    }

    // Dev dependencies
    if (pkg.devDependencies) {
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        deps.push({
          name,
          version: version as string,
          type: 'dev',
          language: 'nodejs',
        });
      }
    }

    // Peer dependencies
    if (pkg.peerDependencies) {
      for (const [name, version] of Object.entries(pkg.peerDependencies)) {
        deps.push({
          name,
          version: version as string,
          type: 'peer',
          language: 'nodejs',
        });
      }
    }

    // Optional dependencies
    if (pkg.optionalDependencies) {
      for (const [name, version] of Object.entries(pkg.optionalDependencies)) {
        deps.push({
          name,
          version: version as string,
          type: 'optional',
          language: 'nodejs',
        });
      }
    }
  } catch {
    // File doesn't exist or invalid JSON
    return [];
  }

  return deps;
}

/**
 * Scan Python dependencies from requirements.txt
 */
async function scanPythonDeps(repoPath: string): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  const reqPath = path.join(repoPath, 'requirements.txt');

  try {
    const content = await fs.readFile(reqPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse format: package==version or package>=version
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)(==|>=|<=|>|<|~=)(.+)$/);
      if (match) {
        deps.push({
          name: match[1],
          version: match[3],
          type: 'prod',
          language: 'python',
        });
      }
    }
  } catch {
    // File doesn't exist
    return [];
  }

  return deps;
}

/**
 * Scan Go dependencies from go.mod
 */
async function scanGoDeps(repoPath: string): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  const goModPath = path.join(repoPath, 'go.mod');

  try {
    const content = await fs.readFile(goModPath, 'utf-8');
    const lines = content.split('\n');

    let inRequireBlock = false;
    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('require (')) {
        inRequireBlock = true;
        continue;
      }

      if (inRequireBlock && trimmed === ')') {
        inRequireBlock = false;
        continue;
      }

      if (inRequireBlock || trimmed.startsWith('require ')) {
        // Parse format: module version
        const match = trimmed.match(/^(?:require\s+)?([^\s]+)\s+v?([^\s]+)/);
        if (match) {
          deps.push({
            name: match[1],
            version: match[2],
            type: 'prod',
            language: 'go',
          });
        }
      }
    }
  } catch {
    // File doesn't exist
    return [];
  }

  return deps;
}

/**
 * Scan Rust dependencies from Cargo.toml
 */
async function scanRustDeps(repoPath: string): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  const cargoPath = path.join(repoPath, 'Cargo.toml');

  try {
    const content = await fs.readFile(cargoPath, 'utf-8');
    const lines = content.split('\n');

    let inDepsSection = false;
    let inDevDepsSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '[dependencies]') {
        inDepsSection = true;
        inDevDepsSection = false;
        continue;
      }

      if (trimmed === '[dev-dependencies]') {
        inDepsSection = false;
        inDevDepsSection = true;
        continue;
      }

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        inDepsSection = false;
        inDevDepsSection = false;
        continue;
      }

      if ((inDepsSection || inDevDepsSection) && trimmed.includes('=')) {
        // Parse format: name = "version" or name = { version = "version" }
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
        if (match) {
          deps.push({
            name: match[1],
            version: match[2],
            type: inDevDepsSection ? 'dev' : 'prod',
            language: 'rust',
          });
        }
      }
    }
  } catch {
    // File doesn't exist
    return [];
  }

  return deps;
}

/**
 * Scan all dependencies in a repository
 */
export async function scanDependencies(repoPath: string): Promise<Dependency[]> {
  const allDeps: Dependency[] = [];

  // Scan all supported languages
  const [nodeDeps, pythonDeps, goDeps, rustDeps] = await Promise.all([
    scanNodeJsDeps(repoPath),
    scanPythonDeps(repoPath),
    scanGoDeps(repoPath),
    scanRustDeps(repoPath),
  ]);

  allDeps.push(...nodeDeps, ...pythonDeps, ...goDeps, ...rustDeps);

  return allDeps;
}
