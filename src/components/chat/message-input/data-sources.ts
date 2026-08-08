import { BUILT_IN_COMMANDS, type PopoverItem } from './constants';

export interface FilePopoverFetchResult {
  items: PopoverItem[];
  hasMore: boolean;
  nextOffset: number;
}

export async function fetchFilePopoverItems(
  workingDirectory: string | undefined,
  filter: string,
  offset: number = 0,
  limit: number = 20,
): Promise<FilePopoverFetchResult> {
  if (!workingDirectory) {
    return { items: [], hasMore: false, nextOffset: 0 };
  }

  const normalizePath = (value: string): string => value.replaceAll('\\', '/');
  const normalizedBaseDir = normalizePath(workingDirectory).replace(/\/+$/, '');
  const normalizedBaseDirLower = normalizedBaseDir.toLowerCase();

  const toDisplayPath = (absolutePath: string): string => {
    const normalizedAbsolutePath = normalizePath(absolutePath);
    const normalizedAbsolutePathLower = normalizedAbsolutePath.toLowerCase();

    if (normalizedAbsolutePathLower === normalizedBaseDirLower) {
      return '.';
    }

    const baseWithSlash = `${normalizedBaseDirLower}/`;
    if (normalizedAbsolutePathLower.startsWith(baseWithSlash)) {
      return normalizedAbsolutePath.slice(normalizedBaseDir.length + 1);
    }

    return normalizedAbsolutePath;
  };

  try {
    const params = new URLSearchParams();
    params.set('dir', workingDirectory);
    params.set('baseDir', workingDirectory);
    params.set('depth', '8');
    params.set('flat', '1');
    params.set('filter', filter);
    params.set('offset', String(Math.max(0, offset)));
    params.set('limit', String(Math.max(1, limit)));
    const res = await fetch(`/api/files?${params.toString()}`);
    if (!res.ok) return { items: [], hasMore: false, nextOffset: offset };

    const data = await res.json();
    const nodes = data.items || [];
    const items: PopoverItem[] = [];

    for (const node of nodes as Array<{ path?: string; type?: string }>) {
      const absolutePath = String(node.path || '');
      if (!absolutePath) continue;
      const displayPath = toDisplayPath(absolutePath);
      items.push({
        label: displayPath,
        value: displayPath,
        description: node.type === 'directory' ? 'directory' : 'file',
      });
    }

    return {
      items,
      hasMore: Boolean(data.hasMore),
      nextOffset: Number.isFinite(data.nextOffset) ? data.nextOffset : (offset + items.length),
    };
  } catch {
    return { items: [], hasMore: false, nextOffset: offset };
  }
}

export async function fetchSkillPopoverItems(
  workingDirectory?: string,
): Promise<PopoverItem[]> {
  let apiSkills: PopoverItem[] = [];

  try {
    const cwdParam = workingDirectory ? `?cwd=${encodeURIComponent(workingDirectory)}` : '';
    const res = await fetch(`/api/skills${cwdParam}`);
    if (res.ok) {
      const data = await res.json();
      const skills = data.skills || [];
      apiSkills = skills
        .map((s: {
          name: string;
          description: string;
          source?: 'global' | 'project' | 'plugin' | 'installed';
          installedSource?: 'agents' | 'claude';
        }) => ({
          label: s.name,
          value: `/${s.name}`,
          description: s.description || '',
          builtIn: false,
          installedSource: s.installedSource,
          source: s.source,
        }));
    }
  } catch {
    // API not available - just use built-in commands
  }

  // Deduplicate: remove API skills that share a name with built-in commands
  const builtInNames = new Set(BUILT_IN_COMMANDS.map(c => c.label));
  const uniqueSkills = apiSkills.filter(s => !builtInNames.has(s.label));

  return [...BUILT_IN_COMMANDS, ...uniqueSkills];
}
