import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distRoot = path.join(root, 'dist');

const requiredPatterns = ['.dmg', '.zip', '.app'];

function collectEntries(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    paths.push(abs);
    if (entry.isDirectory()) {
      paths.push(...collectEntries(abs));
    }
  }

  return paths;
}

function main() {
  if (!fs.existsSync(distRoot)) {
    throw new Error(`Missing dist directory: ${distRoot}`);
  }

  const entries = collectEntries(distRoot);
  if (entries.length === 0) {
    throw new Error(`No artifacts found under ${distRoot}`);
  }

  const found = requiredPatterns.filter((pattern) =>
    entries.some((entry) => entry.endsWith(pattern)),
  );

  if (found.length === 0) {
    throw new Error(
      `No expected Electron artifacts found in ${distRoot}. Found entries:\n${entries.join('\n')}`,
    );
  }

  console.log('Electron artifacts verified successfully.');
  console.log(`Matched patterns: ${found.join(', ')}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
